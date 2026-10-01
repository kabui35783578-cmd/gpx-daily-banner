import { requestUrl } from "obsidian";

// Decoded images are bounded (~24 MiB at 256px/tile); promises deduplicate
// overlapping desktop/mobile requests without storing map tokens on disk.
const tileCache = new Map<string, HTMLImageElement>();
const pendingTiles = new Map<string, Promise<HTMLImageElement>>();
const failedTiles = new Map<string, number>();

export function clearTileCache(): void {
  tileCache.clear();
  failedTiles.clear();
}

export async function loadTileImage(url: string, deadline = Date.now() + 6000): Promise<HTMLImageElement> {
  const cached = tileCache.get(url);
  if (cached) {
    tileCache.delete(url);
    tileCache.set(url, cached);
    return cached;
  }
  if ((failedTiles.get(url) ?? 0) > Date.now()) throw new Error("地图瓦片暂时不可用。");
  const pending = pendingTiles.get(url);
  if (pending) return withTimeout(pending, Math.max(1, deadline - Date.now()), "地图瓦片请求超时。");
  const task = loadCandidates(url, deadline).then((image) => {
    tileCache.set(url, image);
    while (tileCache.size > 96) tileCache.delete(tileCache.keys().next().value!);
    return image;
  }).catch((error) => {
    failedTiles.set(url, Date.now() + 15000);
    while (failedTiles.size > 128) failedTiles.delete(failedTiles.keys().next().value!);
    throw error;
  }).finally(() => pendingTiles.delete(url));
  pendingTiles.set(url, task);
  return task;
}

async function loadCandidates(url: string, deadline: number): Promise<HTMLImageElement> {
  let lastError: unknown;
  for (const candidate of tileUrlCandidates(url).slice(0, 2)) {
    if (Date.now() >= deadline) break;
    try {
      return await loadTileImageOnce(candidate, deadline);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("地图瓦片图片加载失败。");
}

async function loadTileImageOnce(url: string, deadline: number): Promise<HTMLImageElement> {
  const response = await withTimeout(
    requestUrl({
      url,
      method: "GET",
      headers: {
        Accept: "image/png,image/*;q=0.9,*/*;q=0.5",
        "User-Agent": "GPX Daily Banner Obsidian Plugin/0.3"
      }
    }),
    Math.max(1, Math.min(3000, deadline - Date.now())),
    "地图瓦片请求超时。"
  );
  const contentType = headerValue(response.headers, "content-type").toLowerCase();
  if (response.status < 200 || response.status >= 300) {
    throw new Error(tileErrorMessage(response.status));
  }

  if (!contentType.startsWith("image/")) {
    const text = decodePreview(response.arrayBuffer);
    if (looksBlocked(text)) {
      throw new Error("地图服务拒绝了瓦片请求，已切换离线图。");
    }
    throw new Error(`地图瓦片返回了非图片内容：${contentType || "unknown"}`);
  }

  if (contentType.includes("svg") && looksBlocked(decodePreview(response.arrayBuffer))) {
    throw new Error("地图服务返回了拦截提示，已切换离线图。");
  }

  const blob = new Blob([response.arrayBuffer], { type: contentType || "image/png" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    // Install legacy WebView handlers before src (cached images can fire early).
    const decoded = decodeImage(image, Math.max(1, Math.min(3000, deadline - Date.now())));
    image.src = objectUrl;
    await decoded;
    if (tileImageLooksBlocked(image)) {
      throw new Error("地图服务返回了拦截提示，已切换离线图。");
    }
    return image;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

function tileUrlCandidates(url: string): string[] {
  const urls = [url];
  for (const alternateUrl of alternateTileHostUrls(url)) {
    urls.push(alternateUrl);
  }
  return Array.from(new Set(urls));
}

function alternateTileHostUrls(url: string): string[] {
  try {
    const parsed = new URL(url);
    const hostCandidates = alternateTileHosts(parsed.hostname);
    return hostCandidates.map((host) => {
      const copy = new URL(parsed.toString());
      copy.hostname = host;
      return copy.toString();
    });
  } catch {
    return [];
  }
}

function alternateTileHosts(hostname: string): string[] {
  const amapMatch = hostname.match(/^(webrd|wprd|webst)0([1-4])\.is\.autonavi\.com$/);
  if (amapMatch) {
    return ["1", "2", "3", "4"]
      .filter((subdomain) => subdomain !== amapMatch[2])
      .map((subdomain) => `${amapMatch[1]}0${subdomain}.is.autonavi.com`);
  }

  const tencentMatch = hostname.match(/^(p|rt)([0-2])\.map\.gtimg\.com$/);
  if (tencentMatch) {
    return ["0", "1", "2"]
      .filter((subdomain) => subdomain !== tencentMatch[2])
      .map((subdomain) => `${tencentMatch[1]}${subdomain}.map.gtimg.com`);
  }

  const tiandituMatch = hostname.match(/^t([0-7])\.tianditu\.gov\.cn$/);
  if (tiandituMatch) {
    return ["0", "1", "2", "3", "4", "5", "6", "7"]
      .filter((subdomain) => subdomain !== tiandituMatch[1])
      .map((subdomain) => `t${subdomain}.tianditu.gov.cn`);
  }

  const cartoMatch = hostname.match(/^([a-d])\.basemaps\.cartocdn\.com$/);
  if (cartoMatch) {
    return ["a", "b", "c", "d"]
      .filter((subdomain) => subdomain !== cartoMatch[1])
      .map((subdomain) => `${subdomain}.basemaps.cartocdn.com`);
  }

  const topoMatch = hostname.match(/^([a-c])\.tile\.opentopomap\.org$/);
  if (topoMatch) {
    return ["a", "b", "c"]
      .filter((subdomain) => subdomain !== topoMatch[1])
      .map((subdomain) => `${subdomain}.tile.opentopomap.org`);
  }

  return [];
}

function decodeImage(image: HTMLImageElement, timeoutMs: number): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("地图瓦片图片加载失败。"));
    }),
    timeoutMs,
    "地图瓦片图片加载超时。"
  );
}

function headerValue(headers: Record<string, string>, name: string): string {
  const direct = headers[name];
  if (direct) return direct;
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return found?.[1] ?? "";
}

function tileErrorMessage(status: number): string {
  if (status === 401 || status === 403 || status === 418 || status === 429) {
    return `地图服务拒绝了瓦片请求（${status}），已切换离线图。`;
  }
  return `地图瓦片请求失败：${status}`;
}

function decodePreview(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, 4096));
  } catch {
    return "";
  }
}

function looksBlocked(text: string): boolean {
  return /access\s+blocked|blocked|not\s+following|usage\s+policy|too\s+many\s+requests|rate\s+limit/i.test(text);
}

function tileImageLooksBlocked(image: HTMLImageElement): boolean {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(image, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let stripeLike = 0;
    let stripeTotal = 0;
    let whiteLike = 0;
    let total = 0;

    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const offset = (y * 64 + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const black = r < 70 && g < 70 && b < 70;
        const yellow = r > 210 && g > 190 && b < 80;
        const white = r > 235 && g > 235 && b > 235;
        if (x < 8) {
          stripeTotal++;
          if (black || yellow) stripeLike++;
        }
        total++;
        if (white) whiteLike++;
      }
    }

    return stripeLike / stripeTotal > 0.34 && whiteLike / total > 0.42;
  } catch {
    return false;
  }
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function run(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  });
}
