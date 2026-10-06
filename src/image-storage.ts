import { TFile, Vault } from "obsidian";
import { GpxDailyBannerSettings } from "./types";
import { cleanFilePath, ensureFolder, joinPath, parentFolder } from "./utils";

export type HeroImageVariant = "desktop" | "mobile";

export const HERO_IMAGE_DIMENSIONS: Record<HeroImageVariant, { width: number; height: number }> = {
  desktop: { width: 1600, height: 1000 },
  mobile: { width: 900, height: 1600 }
};

export function bannerImagePath(dateKey: string, settings: GpxDailyBannerSettings): string {
  // GPX previews share the desktop hero rather than storing a third image.
  return heroImagePath(dateKey, settings, "desktop");
}

export function heroImagePath(dateKey: string, settings: GpxDailyBannerSettings, variant: HeroImageVariant): string {
  return joinPath(settings.bannerFolder, `${dateKey}-gpx-hero-${variant}.webp`);
}

export function previewImageFile(vault: Vault, dateKey: string, settings: GpxDailyBannerSettings, recordedPath?: string): TFile | null {
  const paths = [
    bannerImagePath(dateKey, settings),
    recordedPath,
    joinPath(settings.bannerFolder, `${dateKey}-gpx-hero-desktop.png`),
    joinPath(settings.bannerFolder, `${dateKey}-gpx-banner.webp`),
    joinPath(settings.bannerFolder, `${dateKey}-gpx-banner.png`)
  ];
  for (const path of paths) {
    if (!path) continue;
    const file = vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return file;
  }
  return null;
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
