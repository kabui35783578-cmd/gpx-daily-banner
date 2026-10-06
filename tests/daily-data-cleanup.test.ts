import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TFile } from "obsidian";
import { cleanupDailyDataSource, isCompleteImageData } from "../src/daily-data-cleanup";
import { DEFAULT_SETTINGS } from "../src/settings";
import { dailyDataRawFileName } from "../src/daily-data-date";
import { BANNER_START, BANNER_END } from "../src/utils";
import type { DailyDataRecord } from "../src/types";

(globalThis as any).Image = class {
  src = ""; naturalWidth = 1; naturalHeight = 1;
  async decode() {}
};
const settings = { ...DEFAULT_SETTINGS, timezoneMode: "utc" as const, autoDeleteDailyDataAfterSuccess: true };
const dateKey = "2026-10-06";
const rawPath = settings.dailyDataBridgeFolder + "/" + dailyDataRawFileName(dateKey, settings) + ".csv";
const text = "1791244800,121,31\n1791244860,121.01,31.01";
const fingerprint = createHash("sha256").update(text).digest("hex");
const files = new Map<string, TFile>();
const texts = new Map<string, string>();
const binaries = new Map<string, ArrayBuffer>();
const add = (path: string, content: string) => {
  const f = new TFile(path); f.stat.size = content.length;
  files.set(path, f); texts.set(path, content); return f;
};
const imageNames = ["desktop", "mobile"].map(variant => `${settings.bannerFolder}/${dateKey}-gpx-hero-${variant}.webp`);
// A minimal RIFF/WebP container; image decode is independently exercised in Obsidian.
const webp = new Uint8Array(20); webp.set(new TextEncoder().encode("RIFF"));
new DataView(webp.buffer).setUint32(4, 12, true); webp.set(new TextEncoder().encode("WEBP"), 8);
for (const path of imageNames) { add(path, ""); binaries.set(path, webp.buffer); }
const notePath = `Daily Notes/${dateKey}.md`;
add(notePath, `${BANNER_START}\n![[${imageNames[0]}]]\n![[${imageNames[1]}]]\n${BANNER_END}`);
const record = (): DailyDataRecord => ({ sourceKind: "bridge", sourcePath: rawPath, dateKey,
  fingerprint, pointCount: 2, imagePath: imageNames[0], notePath, status: "processed" });
const deleted: string[] = [];
const vault = {
  getAbstractFileByPath: (path: string) => files.get(path),
  read: async (f: TFile) => texts.get(f.path)!,
  readBinary: async (f: TFile) => binaries.get(f.path)!,
  getResourcePath: (f: TFile) => f.path,
  delete: async (f: TFile) => { deleted.push(f.path); files.delete(f.path); }
};
let saves = 0;
const save = async () => { saves++; };
const run = (r: DailyDataRecord, saveCallback = save, canDelete = () => true) =>
  cleanupDailyDataSource(vault as never, settings, r, saveCallback, canDelete);

assert.equal(isCompleteImageData(webp.buffer), true);
assert.equal(isCompleteImageData(webp.slice(0, 19).buffer), false, "truncated WebP must block cleanup");
add(rawPath, text); let r = record();
assert.equal(await run(r), 1); assert.equal(r.sourceDeleted, true); assert.equal(saves, 1);
assert.deepEqual(deleted, [rawPath]);
add(rawPath, text); r = record(); r.status = "failed";
assert.equal(await run(r), 0); assert.ok(files.has(rawPath));
r = record(); r.status = "pending-note";
assert.equal(await run(r), 0);
r = record(); r.sourceKind = "external";
assert.equal(await run(r), 0, "never delete external sources");
r = record(); r.sourcePath = "Other/" + files.get(rawPath)!.name;
assert.equal(await run(r), 0, "never delete outside configured bridge folder");
texts.set(rawPath, text + "\nnew point");
assert.equal(await run(record()), 0, "changed data must survive");
texts.set(rawPath, text);
binaries.set(imageNames[1], webp.slice(0, 19).buffer);
assert.equal(await run(record()), 0, "damaged referenced image must preserve its raw source");
binaries.set(imageNames[1], webp.buffer);
await assert.rejects(run(record(), async () => { throw new Error("save failed"); }));
assert.ok(files.has(rawPath), "failed marker save must never delete data");
r = record(); let calls = 0;
assert.equal(await run(r, async () => {
  if (++calls === 1) { texts.set(rawPath, text + "\narrived during save"); files.get(rawPath)!.stat.mtime++; }
}), 0, "a source update during marker save must survive");
assert.equal(r.sourceDeleted, undefined);
texts.set(rawPath, text);
assert.equal(await run(record(), save, () => false), 0, "unload/manual priority/disabled cleanup must block deletion");
settings.autoDeleteDailyDataAfterSuccess = false;
assert.equal(await run(record()), 0, "cleanup requires its own toggle");
console.log("daily-data cleanup success, scope, changed sources, incomplete images and failed-save checks passed");
