import type { TFile } from "obsidian";
import { ParsedTrack, GpxDailyBannerSettings } from "./types";
export { dailyDataRawFileName, unixDayStartSeconds } from "./daily-data-date";
import { basenameWithoutExtension } from "./utils";

export function dateFromTrack(tracks: ParsedTrack[]): Date | undefined {
  for (const track of tracks) {
    for (const segment of track.segments) {
      for (const point of segment.points) {
        if (point.time) return point.time;
      }
    }
  }
  return undefined;
}

export function dateFromFilename(path: string): Date | undefined {
  const base = basenameWithoutExtension(path);
  const patterns = [
    /(^|[^\d])(\d{4})-(\d{2})-(\d{2})([^\d]|$)/,
    /(^|[^\d])(\d{4})_(\d{2})_(\d{2})([^\d]|$)/,
    /(^|[^\d])(\d{4})(\d{2})(\d{2})([^\d]|$)/
  ];
  for (const pattern of patterns) {
    const match = base.match(pattern);
    if (!match) continue;
    const year = Number.parseInt(match[2], 10);
    const month = Number.parseInt(match[3], 10);
    const day = Number.parseInt(match[4], 10);
    if (year > 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }
  return undefined;
}

function partsForDate(date: Date, settings: GpxDailyBannerSettings): { year: number; month: number; day: number } {
  if (settings.timezoneMode === "utc") {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
  if (settings.timezoneMode === "offset") {
    const shifted = new Date(date.getTime() + settings.customTimezoneOffsetMinutes * 60000);
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

export function formatDateWithSettings(date: Date, settings: GpxDailyBannerSettings, format = "YYYY-MM-DD"): string {
  const { year, month, day } = partsForDate(date, settings);
  return format
    .replace(/YYYY/g, String(year).padStart(4, "0"))
    .replace(/MM/g, String(month).padStart(2, "0"))
    .replace(/DD/g, String(day).padStart(2, "0"));
}

export function resolveTrackDate(
  file: TFile,
  tracks: ParsedTrack[],
  metadataTime: Date | undefined,
  settings: GpxDailyBannerSettings
): { date: Date; dateKey: string } {
  const date = dateFromTrack(tracks) ?? metadataTime ?? dateFromFilename(file.path) ?? new Date(file.stat.ctime || file.stat.mtime);
  return {
    date,
    dateKey: formatDateWithSettings(date, settings, "YYYY-MM-DD")
  };
}

export function todayKey(settings: GpxDailyBannerSettings): string {
  return formatDateWithSettings(new Date(), settings, "YYYY-MM-DD");
}
