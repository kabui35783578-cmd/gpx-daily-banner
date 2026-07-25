import { TFile, Vault } from "obsidian";
import { GpxDailyBannerSettings } from "./types";
import { cleanFilePath, ensureFolder, joinPath, parentFolder } from "./utils";

export function bannerImagePath(dateKey: string, settings: GpxDailyBannerSettings): string {
  return joinPath(settings.bannerFolder, `${dateKey}-gpx-banner.png`);
}

export async function saveBannerImage(vault: Vault, path: string, data: ArrayBuffer): Promise<TFile> {
  const cleanPath = cleanFilePath(path);
  await ensureFolder(vault, parentFolder(cleanPath));
  const existing = vault.getAbstractFileByPath(cleanPath);
  if (existing instanceof TFile) {
    await vault.modifyBinary(existing, data);
    return existing;
  }
  return await vault.createBinary(cleanPath, data);
}
