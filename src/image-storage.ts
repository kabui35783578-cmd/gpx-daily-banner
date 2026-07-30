import { TFile, Vault } from "obsidian";
import { GpxDailyBannerSettings } from "./types";
import { cleanFilePath, ensureFolder, joinPath, parentFolder } from "./utils";

export type HeroImageVariant = "desktop" | "mobile";

export const HERO_IMAGE_DIMENSIONS: Record<HeroImageVariant, { width: number; height: number }> = {
  desktop: { width: 1600, height: 1000 },
  mobile: { width: 900, height: 1600 }
};

export function bannerImagePath(dateKey: string, settings: GpxDailyBannerSettings): string {
  return joinPath(settings.bannerFolder, `${dateKey}-gpx-banner.png`);
}

export function heroImagePath(dateKey: string, settings: GpxDailyBannerSettings, variant: HeroImageVariant): string {
  return joinPath(settings.bannerFolder, `${dateKey}-gpx-hero-${variant}.png`);
}

export function heroImagePaths(dateKey: string, settings: GpxDailyBannerSettings): { desktop: string; mobile: string } {
  return {
    desktop: heroImagePath(dateKey, settings, "desktop"),
    mobile: heroImagePath(dateKey, settings, "mobile")
  };
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
