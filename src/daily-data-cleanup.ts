import { TFile, Vault } from "obsidian";
import { dailyDataRawFileName } from "./daily-data-date";
import { fingerprintText } from "./daily-data-source";
import { extractBannerImagePaths } from "./daily-note";
import { DailyDataRecord, GpxDailyBannerSettings } from "./types";
import { cleanFolderPath, joinPath } from "./utils";

export function isCompleteImageData(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data);
  if (bytes.length < 20) return false;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return new DataView(data).getUint32(4, true) + 8 === bytes.length;
  }
  return bytes[0] === 137 && ascii(1, 4) === "PNG"
    && ascii(bytes.length - 8, bytes.length - 4) === "IEND";
}

export async function storedHeroImagesReady(vault: Vault, record: DailyDataRecord): Promise<boolean> {
  const note = vault.getAbstractFileByPath(record.notePath);
  if (!(note instanceof TFile)) return false;
  const paths = extractBannerImagePaths(await vault.read(note));
  if (paths.length !== 2 || new Set(paths).size !== 2) return false;
  for (const path of paths) {
    const file = vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || !isCompleteImageData(await vault.readBinary(file))) return false;
    const image = new Image();
    image.src = vault.getResourcePath(file);
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) return false;
  }
  return true;
}

/** Only delete matching, successfully rendered Vault bridge data, never external originals. */
export async function cleanupDailyDataSource(
  vault: Vault, settings: GpxDailyBannerSettings, record: DailyDataRecord,
  saveData: () => Promise<void>, canDelete: () => boolean
): Promise<number> {
  if (!settings.autoDeleteDailyDataAfterSuccess || record.sourceKind !== "bridge"
      || record.status !== "processed" || !canDelete()) return 0;
  const folder = cleanFolderPath(settings.dailyDataBridgeFolder);
  if (!folder) return 0;
  const rawName = dailyDataRawFileName(record.dateKey, settings);
  const paths = [joinPath(folder, rawName), joinPath(folder, rawName + ".csv")];
  if (!paths.includes(record.sourcePath)) return 0;
  if (!paths.some(path => vault.getAbstractFileByPath(path) instanceof TFile)) return 0;
  if (!await storedHeroImagesReady(vault, record)) return 0;
  let removed = 0;
  for (const path of paths) {
    const file = vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || !canDelete()) continue;
    const size = file.stat.size, mtime = file.stat.mtime;
    const text = await vault.read(file);
    if (await fingerprintText(text) !== record.fingerprint || !canDelete()
        || file.stat.size !== size || file.stat.mtime !== mtime) continue;
    // Persist the cleanup marker first; failed saves never permit source deletion.
    const previousDeleted = record.sourceDeleted;
    record.sourceDeleted = true;
    try { await saveData(); }
    catch (error) { record.sourceDeleted = previousDeleted; throw error; }
    try {
      // Recheck after the asynchronous save: a newly synced track must survive.
      if (!canDelete() || file.stat.size !== size || file.stat.mtime !== mtime
          || await vault.read(file) !== text) {
        record.sourceDeleted = previousDeleted;
        await saveData();
        continue;
      }
      if (!canDelete() || file.stat.size !== size || file.stat.mtime !== mtime) {
        record.sourceDeleted = previousDeleted;
        await saveData();
        continue;
      }
      await vault.delete(file);
      removed++;
    } catch (error) {
      if (!removed) record.sourceDeleted = previousDeleted;
      await saveData();
      throw error;
    }
  }
  return removed;
}
