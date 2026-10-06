import assert from "node:assert/strict";
import { TFile, requests, Platform } from "obsidian";
import { BannerManager } from "../src/banner-manager";
import { hasManualOverride, latestManualRecord } from "../src/banner-priority";
import { DEFAULT_SETTINGS } from "../src/settings";
import { dailyDataRawFileName } from "../src/daily-data-date";
import { ProcessingQueue } from "../src/processing-queue";
import { clearTileCache, loadTileImage } from "../src/tile-loader";
import { renders, setOnRender } from "./render-mock";
import type { PluginData } from "../src/types";
import { bannerImagePath, previewImageFile } from "../src/image-storage";
import { canvasToArrayBuffer } from "../src/utils";

(globalThis as any).window = globalThis;
(globalThis as any).innerWidth = 1200;
(globalThis as any).Image = class {
  decoding = "";
  onload?: () => void;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
};
const dateKey = "2026-07-24";
const settings = { ...DEFAULT_SETTINGS, timezoneMode: "utc" as const, autoCreateDailyNote: true };
const files = new Map<string, TFile>();
const contents = new Map<string, string>();
const writes: string[] = [];
const makeFile = (path: string, text: string) => {
  const file = new TFile(path);
  files.set(path, file);
  contents.set(path, text);
  return file;
};
const vault = {
  getAbstractFileByPath: (path: string) => files.get(path),
  getFiles: () => [...files.values()],
  read: async (file: TFile) => contents.get(file.path)!,
  createFolder: async (path: string) => { files.set(path, {} as TFile); },
  create: async (path: string, text: string) => makeFile(path, text),
  createBinary: async (path: string, bytes: ArrayBuffer) => { writes.push(path); return makeFile(path, new TextDecoder().decode(bytes)); },
  modifyBinary: async (file: TFile, bytes: ArrayBuffer) => { writes.push(file.path); contents.set(file.path, new TextDecoder().decode(bytes)); },
  process: async (file: TFile, update: (text: string) => string) => { contents.set(file.path, update(contents.get(file.path)!)); },
  delete: async (file: TFile) => { files.delete(file.path); contents.delete(file.path); },
  rename: async (file: TFile, path: string) => { files.delete(file.path); const text = contents.get(file.path)!; contents.delete(file.path); file.path = path; files.set(path, file); contents.set(path, text); }
};
const data: PluginData = { records: {}, dailyDataRecords: {} };
const manager = new BannerManager(vault as never, () => settings, () => data, async () => {});
const rawPath = `${settings.dailyDataBridgeFolder}/${dailyDataRawFileName(dateKey, settings)}`;
makeFile(rawPath, "1784887200,121,31\n1784887260,121.01,31.01");

// First hero is published before rendering the second; no third image is stored.
setOnRender(async (_input, dimensions) => {
  if (dimensions.imageWidth === 900) {
    assert.equal(writes.length, 1);
    assert.ok(contents.get(`Daily Notes/${dateKey}.md`)!.includes("hero-desktop.webp"));
  }
});
await manager.refreshDailyDataForDate(dateKey);
setOnRender();
assert.equal(writes.length, 2);
assert.ok(writes[0].endsWith("hero-desktop.webp"));
assert.ok(writes[1].endsWith("hero-mobile.webp"));
assert.equal(data.dailyDataRecords[dateKey].imagePath, writes[0], "preview must reuse the desktop hero");
assert.ok(!writes.some(path => path.endsWith("gpx-banner.png")), "no legacy third image");
const renderCount = renders.length;
await manager.refreshDailyDataForDate(dateKey);
assert.equal(renders.length, renderCount, "unchanged daily source should not render");

// A source change arriving during generation is drained, not discarded.
let releaseRefresh!: () => void;
let refreshEntered!: () => void;
let pausedRefresh = false;
const refreshStarted = new Promise<void>((resolve) => { refreshEntered = resolve; });
const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
setOnRender(async () => {
  if (!pausedRefresh) { pausedRefresh = true; refreshEntered(); await refreshGate; }
});
const refreshInProgress = manager.refreshDailyDataForDate(dateKey, { force: true });
await refreshStarted;
contents.set(rawPath, contents.get(rawPath)! + "\n1784887320,121.02,31.02");
files.get(rawPath)!.stat.mtime++;
const refreshChanged = manager.refreshDailyDataForDate(dateKey);
releaseRefresh();
await Promise.all([refreshInProgress, refreshChanged]);
setOnRender();
assert.equal(data.dailyDataRecords[dateKey].pointCount, 3, "latest source change must be rendered");

const first = makeFile("first.gpx", "first");
await Promise.all([
  manager.processGpxFile(first, { skipStabilityCheck: true }),
  manager.processGpxFile(first, { skipStabilityCheck: true })
]);
assert.equal(renders.filter((entry) => entry.startsWith("first:")).length, 2, "deduplicate imports");
assert.equal(hasManualOverride(data, dateKey), true);
const beforeAutomatic = renders.length;
await manager.refreshDailyDataForDate(dateKey, { force: true });
assert.equal(renders.length, beforeAutomatic, "force refresh must not overwrite manual GPX");
await manager.regenerateForDate(dateKey);
assert.ok(renders.at(-1)!.startsWith("first:"), "regeneration must use selected manual GPX");

const second = makeFile("second.gpx", "second");
await manager.processGpxFile(second, { skipStabilityCheck: true });
assert.equal(latestManualRecord(data, dateKey)?.path, "second.gpx");
settings.autoDeleteAfterSuccess = true;
await manager.processGpxFile(second, { force: true, skipStabilityCheck: true });
assert.equal(data.records["second.gpx"].sourceDeleted, true);
const beforeMissing = renders.length;
await manager.regenerateForDate(dateKey);
assert.equal(renders.length, beforeMissing, "deleted manual source must not fall back to automatic");
await manager.restoreAutomaticForDate(dateKey);
assert.equal(hasManualOverride(data, dateKey), false);
assert.ok(renders.at(-1)!.startsWith("一生足迹:"));

// A queued automatic refresh must recheck priority after the manual job finishes.
settings.autoDeleteAfterSuccess = false;
let release!: () => void;
let entered!: () => void;
const started = new Promise<void>((resolve) => { entered = resolve; });
const gate = new Promise<void>((resolve) => { release = resolve; });
setOnRender(async (input) => { if (input.tracks[0].name === "third") { entered(); await gate; } });
const third = makeFile("third.gpx", "third");
const manualJob = manager.processGpxFile(third, { skipStabilityCheck: true });
await started;
const autoJob = manager.refreshDailyDataForDate(dateKey, { force: true });
await new Promise((resolve) => setTimeout(resolve, 500));
release();
await Promise.all([manualJob, autoJob]);
setOnRender();
assert.ok(renders.at(-1)!.startsWith("third:"));

// Mobile publishes its portrait image first.
Platform.isMobile = true;
const startWrites = writes.length;
await manager.processGpxFile(makeFile("mobile.gpx", "mobile"), { skipStabilityCheck: true });
assert.ok(writes[startWrites].endsWith("hero-mobile.webp"));
assert.ok(data.records["mobile.gpx"].imagePath.endsWith("hero-desktop.webp"), "mobile imports also reuse desktop for preview");
Platform.isMobile = false;

// Failed parsing and a missing automatic source cannot release a good manual selection.
await manager.processGpxFile(makeFile("invalid.gpx", "invalid"), { force: true, skipStabilityCheck: true });
assert.equal(latestManualRecord(data, dateKey)?.path, "mobile.gpx");
files.delete(rawPath);
await manager.restoreAutomaticForDate(dateKey);
assert.equal(hasManualOverride(data, dateKey), true);
makeFile(rawPath, "1784887200,121,31\n1784887260,121.01,31.01");

// External desktop settings use the Vault bridge on mobile, without being changed.
await manager.restoreAutomaticForDate(dateKey);
Platform.isMobile = true;
settings.dailyDataSourceMode = "external";
await manager.refreshDailyDataForDate(dateKey, { force: true });
assert.equal(settings.dailyDataSourceMode, "external");
assert.ok(renders.at(-1)!.startsWith("一生足迹:"));
settings.dailyDataSourceMode = "bridge";
Platform.isMobile = false;

// Explicit override bypasses the optional same-day merge mode.
settings.sameDayMode = "merge";
const explicit = makeFile("explicit.gpx", "explicit");
await manager.processGpxFile(explicit, { force: true, skipStabilityCheck: true });
assert.ok(renders.at(-1)!.startsWith("explicit:"));
settings.sameDayMode = "replace";

// Archives update the selected path, so subsequent regeneration uses the moved source.
settings.archiveAfterSuccess = true;
await manager.processGpxFile(explicit, { force: true, skipStabilityCheck: true });
assert.ok(latestManualRecord(data, dateKey)!.path.startsWith("GPX Archive/"));
assert.equal(data.records["explicit.gpx"], undefined);
settings.archiveAfterSuccess = false;

// The bounded image cache reuses in-flight and decoded tiles; failures cool down.
clearTileCache();
const tiles = await Promise.all([loadTileImage("https://test/tile.png"), loadTileImage("https://test/tile.png")]);
assert.equal(tiles[0], tiles[1]);
await loadTileImage("https://test/tile.png");
assert.equal(requests.filter((url) => url.includes("tile.png")).length, 1);
await assert.rejects(loadTileImage("https://test/fail.png"));
await assert.rejects(loadTileImage("https://test/fail.png"));
assert.equal(requests.filter((url) => url.includes("fail.png")).length, 1);

// A failing task doesn't block the next job for that date.
const queue = new ProcessingQueue();
await assert.rejects(queue.runForFile("bad", dateKey, async () => { throw new Error("test"); }));
let ran = false;
await queue.runForFile("good", dateKey, async () => { ran = true; });
assert.equal(ran, true);

// New previews prefer the shared WebP but still open old PNG-only records.
const oldDate = "2026-06-20";
const legacy = makeFile(`${settings.bannerFolder}/${oldDate}-gpx-banner.png`, "legacy");
assert.equal(previewImageFile(vault as never, oldDate, settings, legacy.path), legacy);
const migrated = makeFile(bannerImagePath(oldDate, settings), "webp");
assert.equal(previewImageFile(vault as never, oldDate, settings, legacy.path), migrated);
assert.equal(previewImageFile(vault as never, "1900-01-01", settings), null);

// Reject a browser PNG fallback rather than saving PNG bytes under .webp.
let exportType = "";
let exportQuality = 0;
const canvas = { toBlob(callback: BlobCallback, type: string, quality: number) {
  exportType = type; exportQuality = quality;
  callback(new Blob(["webp"], { type: "image/webp" }));
} } as unknown as HTMLCanvasElement;
assert.equal(new TextDecoder().decode(await canvasToArrayBuffer(canvas)), "webp");
assert.equal(exportType, "image/webp");
assert.equal(exportQuality, 0.92);
await assert.rejects(canvasToArrayBuffer({ toBlob(callback: BlobCallback) { callback(new Blob(["png"], { type: "image/png" })); } } as HTMLCanvasElement));
await assert.rejects(canvasToArrayBuffer({ toBlob(callback: BlobCallback) { callback(null); } } as HTMLCanvasElement));
console.log("banner workflow, priority, progressive rendering, mobile, tile cache and queue checks passed");
