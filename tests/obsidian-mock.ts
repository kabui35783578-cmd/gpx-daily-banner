export class TFile {
  stat = { size: 1, mtime: 1, ctime: 1 };
  constructor(public path: string) {}
  get name() { return this.path.split("/").pop()!; }
  get extension() { return this.name.split(".").pop()!; }
  get basename() { return this.name.replace(/\.[^.]+$/, ""); }
}
export class Notice { constructor(public message: string) {} }
export class PluginSettingTab {}
export class Setting {}
export class FileSystemAdapter {}
export const Platform = { isMobile: false };
export function normalizePath(path: string) { return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/"); }
export const requests: string[] = [];
export async function requestUrl({ url }: { url: string }) {
  requests.push(url);
  if (url.includes("fail")) throw new Error("network failed");
  return { status: 200, headers: { "content-type": "image/png" }, arrayBuffer: new ArrayBuffer(8) };
}
