import { centerOfBounds, collectBounds, convertTracksForMap, lonLatToWorldPixel, simplifyTracks, tileUrl } from "./coordinate";
import { getMapTilePreset, MapTilePreset } from "./map-presets";
import { GpxDailyBannerSettings, MapTilePresetId, RenderInput } from "./types";
import { loadTileImage, mapWithConcurrency } from "./tile-loader";
import { canvasToArrayBuffer, formatDistance, formatDuration } from "./utils";

export interface Viewport {
  zoom: number;
  scale: number;
  topLeftWorld: { x: number; y: number };
  minTileX: number;
  maxTileX: number;
  minTileY: number;
  maxTileY: number;
}

interface TileTask {
  x: number;
  y: number;
  url: string;
}

interface LoadedTile extends TileTask {
  image: HTMLImageElement;
}

export async function renderMapBanner(input: RenderInput, settings: GpxDailyBannerSettings): Promise<ArrayBuffer> {
  let lastError: unknown;
  for (const source of mapTileSources(settings)) {
    try {
      return await renderMapBannerWithSource(input, settings, source);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("地图源全部加载失败。");
}

async function renderMapBannerWithSource(input: RenderInput, settings: GpxDailyBannerSettings, source: MapTilePreset): Promise<ArrayBuffer> {
  if (source.requiresToken && !settings.mapTileToken.trim()) {
    throw new Error("天地图需要 TK，请在高级设置中填写；也可以先切换到高德地图。");
  }

  const tracks = simplifyTracks(convertTracksForMap(input.tracks, settings.trackCoordinateSystem, source.coordinateSystem));
  const canvas = document.createElement("canvas");
  canvas.width = settings.imageWidth;
  canvas.height = settings.imageHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持 Canvas。");

  const viewport = chooseViewport(tracks, { ...settings, maxZoom: Math.min(settings.maxZoom, source.maxZoom) });
  const tileTasks = [];
  for (let x = viewport.minTileX; x <= viewport.maxTileX; x++) {
    for (let y = viewport.minTileY; y <= viewport.maxTileY; y++) {
      tileTasks.push({
        x,
        y,
        url: tileUrl(source.tileUrlTemplate, viewport.zoom, x, y, {
          subdomains: source.subdomains,
          tileYMode: source.tileYMode,
          token: settings.mapTileToken
        })
      });
    }
  }
  if (tileTasks.length > settings.maxTileCount) {
    throw new Error("地图瓦片数量超过限制，已切换离线图。");
  }

  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const loadedTiles = await loadVisibleTiles(tileTasks);
  for (const tile of loadedTiles) {
    const dx = (tile.x * 256 - viewport.topLeftWorld.x) * viewport.scale;
    const dy = (tile.y * 256 - viewport.topLeftWorld.y) * viewport.scale;
    ctx.drawImage(tile.image, dx, dy, 256 * viewport.scale, 256 * viewport.scale);
  }

  tracks.forEach((track, trackIndex) => {
    ctx.strokeStyle = settings.trackColors[trackIndex % settings.trackColors.length] ?? settings.trackColor;
    ctx.lineWidth = settings.trackLineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(15, 23, 42, 0.35)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    for (const segment of track.segments) {
      if (segment.points.length < 2) continue;
      ctx.beginPath();
      segment.points.forEach((point, index) => {
        const world = lonLatToWorldPixel(point.lat, point.lon, viewport.zoom);
        const x = (world.x - viewport.topLeftWorld.x) * viewport.scale;
        const y = (world.y - viewport.topLeftWorld.y) * viewport.scale;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  });
  ctx.shadowColor = "transparent";

  const allSegments = tracks.flatMap((track) => track.segments).filter((segment) => segment.points.length > 0);
  const first = allSegments[0]?.points[0];
  const lastSegment = allSegments[allSegments.length - 1];
  const last = lastSegment?.points[lastSegment.points.length - 1];
  drawMarker(ctx, projectPoint(first, viewport), "#22c55e", settings.showStartMarker);
  drawMarker(ctx, projectPoint(last, viewport), "#ef4444", settings.showEndMarker);
  drawInfo(ctx, input, settings);
  drawAttribution(ctx, source.tileAttribution, canvas.width, canvas.height);

  return canvasToArrayBuffer(canvas);
}

function mapTileSources(settings: GpxDailyBannerSettings): MapTilePreset[] {
  const selected = configuredMapTileSource(settings);
  if (selected.id === "custom") return [selected];

  const fallbackIds: MapTilePresetId[] = ["amap-standard", "tencent-satellite", "carto-light"];
  const fallbackSources = fallbackIds
    .filter((id) => id !== selected.id)
    .map((id) => getMapTilePreset(id))
    .filter((preset): preset is MapTilePreset => Boolean(preset));
  return [selected, ...fallbackSources];
}

function configuredMapTileSource(settings: GpxDailyBannerSettings): MapTilePreset {
  const preset = getMapTilePreset(settings.mapTilePreset);
  if (preset) return preset;
  return {
    id: "custom",
    name: "自定义",
    tileUrlTemplate: settings.tileUrlTemplate,
    tileAttribution: settings.tileAttribution,
    maxZoom: settings.maxZoom,
    coordinateSystem: "wgs84",
    subdomains: ["a", "b", "c", "d"],
    tileYMode: "xyz"
  };
}

async function loadVisibleTiles(tileTasks: TileTask[]): Promise<LoadedTile[]> {
  const loadedTiles = (
    await mapWithConcurrency(tileTasks, 4, async (tile): Promise<LoadedTile | undefined> => {
      try {
        return { ...tile, image: await loadTileImage(tile.url) };
      } catch {
        return undefined;
      }
    })
  ).filter((tile): tile is LoadedTile => Boolean(tile));

  const minimumLoadedTiles = Math.max(1, Math.ceil(tileTasks.length * 0.75));
  if (loadedTiles.length < minimumLoadedTiles) {
    throw new Error("地图瓦片加载不完整，正在尝试备用地图源。");
  }

  return loadedTiles;
}

export function chooseViewport(tracks: RenderInput["tracks"], settings: GpxDailyBannerSettings): Viewport {
  const bounds = collectBounds(tracks);
  const center = centerOfBounds(bounds);
  const padding = 72;
  const scales = [1, 1.15, 1.35, 1.6, 2];

  for (let zoom = settings.maxZoom; zoom >= 1; zoom--) {
    const northWest = lonLatToWorldPixel(bounds.maxLat, bounds.minLon, zoom);
    const southEast = lonLatToWorldPixel(bounds.minLat, bounds.maxLon, zoom);
    const bboxWidth = Math.abs(southEast.x - northWest.x);
    const bboxHeight = Math.abs(southEast.y - northWest.y);
    for (const scale of scales) {
      if (bboxWidth * scale > settings.imageWidth - padding * 2 || bboxHeight * scale > settings.imageHeight - padding * 2) continue;
      const centerWorld = lonLatToWorldPixel(center.lat, center.lon, zoom);
      const topLeftWorld = {
        x: centerWorld.x - settings.imageWidth / (2 * scale),
        y: centerWorld.y - settings.imageHeight / (2 * scale)
      };
      const minTileX = Math.floor(topLeftWorld.x / 256);
      const minTileY = Math.floor(topLeftWorld.y / 256);
      const maxTileX = Math.floor((topLeftWorld.x + settings.imageWidth / scale) / 256);
      const maxTileY = Math.floor((topLeftWorld.y + settings.imageHeight / scale) / 256);
      const tileCount = (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1);
      if (tileCount <= settings.maxTileCount) {
        return { zoom, scale, topLeftWorld, minTileX, minTileY, maxTileX, maxTileY };
      }
    }
  }

  const zoom = Math.max(1, Math.min(settings.maxZoom, 10));
  const centerWorld = lonLatToWorldPixel(center.lat, center.lon, zoom);
  const scale = 2;
  const topLeftWorld = {
    x: centerWorld.x - settings.imageWidth / (2 * scale),
    y: centerWorld.y - settings.imageHeight / (2 * scale)
  };
  return {
    zoom,
    scale,
    topLeftWorld,
    minTileX: Math.floor(topLeftWorld.x / 256),
    minTileY: Math.floor(topLeftWorld.y / 256),
    maxTileX: Math.floor((topLeftWorld.x + settings.imageWidth / scale) / 256),
    maxTileY: Math.floor((topLeftWorld.y + settings.imageHeight / scale) / 256)
  };
}

function projectPoint(point: { lat: number; lon: number } | undefined, viewport: Viewport): { x: number; y: number } | undefined {
  if (!point) return undefined;
  const world = lonLatToWorldPixel(point.lat, point.lon, viewport.zoom);
  return {
    x: (world.x - viewport.topLeftWorld.x) * viewport.scale,
    y: (world.y - viewport.topLeftWorld.y) * viewport.scale
  };
}

function drawMarker(ctx: CanvasRenderingContext2D, point: { x: number; y: number } | undefined, color: string, enabled: boolean): void {
  if (!enabled || !point) return;
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawInfo(ctx: CanvasRenderingContext2D, input: RenderInput, settings: GpxDailyBannerSettings): void {
  const lines = [
    settings.showDate ? input.stats.dateLabel : undefined,
    settings.showDistance ? formatDistance(input.stats.distanceMeters) : undefined,
    settings.showDuration ? formatDuration(input.stats.durationMs) : undefined
  ].filter((line): line is string => Boolean(line));
  if (!lines.length) return;

  ctx.font = "600 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textBaseline = "top";
  const maxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const x = 32;
  const y = 32;
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  roundRect(ctx, x - 16, y - 14, maxWidth + 32, lines.length * 36 + 28, 18);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * 36));
}

function drawAttribution(ctx: CanvasRenderingContext2D, attribution: string, width: number, height: number): void {
  ctx.font = "14px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  const textWidth = ctx.measureText(attribution).width;
  const x = width - textWidth - 18;
  const y = height - 28;
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillRect(x - 8, y - 4, textWidth + 16, 22);
  ctx.fillStyle = "#1f2937";
  ctx.fillText(attribution, x, y + 1);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
