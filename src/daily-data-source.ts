import { FileSystemAdapter, TFile, Vault } from "obsidian";
import { dailyDataRawFileName } from "./daily-data-date";
import { DailyDataSourceKind, GpxDailyBannerSettings } from "./types";
import { cleanFilePath, debug, joinPath } from "./utils";

export interface DailyDataSource {
  kind: DailyDataSourceKind;
  path: string;
  fileName: string;
  text: string;
  fingerprint: string;
}

export interface DailyDataReadResult {
  source?: DailyDataSource;
  attemptedPaths: string[];
}

export async function readDailyDataForDate(vault: Vault, settings: GpxDailyBannerSettings, dateKey: string): Promise<DailyDataReadResult> {
  const fileName = dailyDataRawFileName(dateKey, settings);
  if (settings.dailyDataSourceMode === "external") {
    return await readExternalData(settings, fileName);
  }
  return await readBridgeData(vault, settings, fileName);
}

async function readExternalData(settings: GpxDailyBannerSettings, fileName: string): Promise<DailyDataReadResult> {
  const attemptedPaths: string[] = [];
  for (const path of externalCandidates(settings.lifeFootprintFolder, fileName)) {
    attemptedPaths.push(path);
    const text = await readExternalText(path, settings);
    if (text === undefined) continue;
    return {
      source: {
        kind: "external",
        path,
        fileName,
        text,
        fingerprint: await fingerprintText(text)
      },
      attemptedPaths
    };
  }
  return { attemptedPaths };
}

async function readBridgeData(vault: Vault, settings: GpxDailyBannerSettings, fileName: string): Promise<DailyDataReadResult> {
  const attemptedPaths: string[] = [];
  for (const path of bridgeCandidates(settings.dailyDataBridgeFolder, fileName)) {
    attemptedPaths.push(path);
    const file = vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    try {
      const text = await vault.read(file);
      return {
        source: {
          kind: "bridge",
          path,
          fileName,
          text,
          fingerprint: await fingerprintText(text)
        },
        attemptedPaths
      };
    } catch (error) {
      debug(settings, "daily data bridge read failed", path, error);
    }
  }
  return { attemptedPaths };
}

function externalCandidates(folder: string, fileName: string): string[] {
  const normalizedFolder = folder.trim().replace(/[\\/]+$/, "");
  if (!normalizedFolder) return [];
  return uniquePaths([`${normalizedFolder}/${fileName}`, `${normalizedFolder}/${fileName}.csv`]);
}

function bridgeCandidates(folder: string, fileName: string): string[] {
  const normalizedFolder = cleanFilePath(folder);
  if (!normalizedFolder) return [];
  return uniquePaths([joinPath(normalizedFolder, fileName), joinPath(normalizedFolder, `${fileName}.csv`)]);
}

async function readExternalText(path: string, settings: GpxDailyBannerSettings): Promise<string | undefined> {
  const adapter = FileSystemAdapter as typeof FileSystemAdapter | undefined;
  if (!adapter || typeof adapter.readLocalFile !== "function") {
    debug(settings, "external file reader unavailable", path);
    return undefined;
  }
  try {
    const buffer = await adapter.readLocalFile(path);
    return new TextDecoder("utf-8").decode(buffer);
  } catch (error) {
    debug(settings, "external daily data read failed", path, error);
    return undefined;
  }
}

async function fingerprintText(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${text.length}:${text.slice(0, 64)}:${text.slice(-64)}`;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}
