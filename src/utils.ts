import { normalizePath, TAbstractFile, TFile, Vault } from "obsidian";
import { GpxDailyBannerSettings } from "./types";

export const BANNER_START = "<!-- gpx-daily-banner:start -->";
export const BANNER_END = "<!-- gpx-daily-banner:end -->";

export function cleanFolderPath(path: string): string {
  return normalizePath(path.trim()).replace(/^\/+|\/+$/g, "");
}

export function cleanFilePath(path: string): string {
  return normalizePath(path.trim()).replace(/^\/+/g, "");
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/")).replace(/^\/+/g, "");
}

export function isTFile(file: TAbstractFile | null): file is TFile {
  return file instanceof TFile;
}

export function isGpxFile(file: TAbstractFile | null): file is TFile {
  return isTFile(file) && file.extension.toLowerCase() === "gpx";
}

export function fileIsInFolder(file: TFile, folder: string): boolean {
  const cleanFolder = cleanFolderPath(folder);
  if (!cleanFolder) return false;
  return file.path === cleanFolder || file.path.startsWith(`${cleanFolder}/`);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function ensureFolder(vault: Vault, folder: string): Promise<void> {
  const normalized = cleanFolderPath(folder);
  if (!normalized) return;
  const parts = normalized.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!vault.getAbstractFileByPath(current)) {
      await vault.createFolder(current);
    }
  }
}

export function parentFolder(path: string): string {
  const normalized = cleanFilePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

export function basenameWithoutExtension(path: string): string {
  const name = cleanFilePath(path).split("/").pop() ?? path;
  const index = name.lastIndexOf(".");
  return index === -1 ? name : name.slice(0, index);
}

export function sanitizeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export async function canvasToArrayBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("无法从 Canvas 导出图片。"));
    }, "image/png");
  });
  return await blob.arrayBuffer();
}

export function formatDistance(distanceMeters?: number): string | undefined {
  if (distanceMeters === undefined || !Number.isFinite(distanceMeters)) return undefined;
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(2)} km`;
}

export function formatDuration(durationMs?: number): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return undefined;
  const minutes = Math.round(durationMs / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export function replaceCssVariables(settings: GpxDailyBannerSettings): void {
  document.documentElement.style.setProperty("--gpx-banner-height", `${settings.desktopBannerHeight}px`);
  document.documentElement.style.setProperty("--gpx-banner-mobile-height", `${settings.mobileBannerHeight}px`);
  document.documentElement.style.setProperty("--gpx-banner-radius", `${settings.bannerRadius}px`);
}

export function debug(settings: GpxDailyBannerSettings, ...args: unknown[]): void {
  if (settings.debugLogging) {
    console.log("[GPX Daily Banner]", ...args);
  }
}

export async function waitForStableFile(vault: Vault, file: TFile, maxRetries = 3): Promise<TFile | null> {
  let previousSize = -1;
  let latest: TFile | null = file;
  await delay(800);
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const candidate = vault.getAbstractFileByPath(file.path);
    if (!isTFile(candidate)) return null;
    latest = candidate;
    const size = candidate.stat.size;
    if (size > 0 && size === previousSize) return candidate;
    previousSize = size;
    await delay(600);
  }
  const candidate = vault.getAbstractFileByPath(file.path);
  return isTFile(candidate) && candidate.stat.size > 0 ? candidate : latest;
}

export function uniqueArray<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
