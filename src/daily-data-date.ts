import type { GpxDailyBannerSettings } from "./types";

export function unixDayStartSeconds(dateKey: string, settings: GpxDailyBannerSettings): number {
  const year = Number.parseInt(dateKey.slice(0, 4), 10);
  const month = Number.parseInt(dateKey.slice(5, 7), 10);
  const day = Number.parseInt(dateKey.slice(8, 10), 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`无法从日期生成一生足迹文件名：${dateKey}`);
  }

  if (settings.timezoneMode === "utc") {
    return Math.floor(Date.UTC(year, month - 1, day) / 1000);
  }
  if (settings.timezoneMode === "offset") {
    return Math.floor((Date.UTC(year, month - 1, day) - settings.customTimezoneOffsetMinutes * 60000) / 1000);
  }
  return Math.floor(new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 1000);
}

export function dailyDataRawFileName(dateKey: string, settings: GpxDailyBannerSettings): string {
  return `${unixDayStartSeconds(dateKey, settings)}_raw`;
}
