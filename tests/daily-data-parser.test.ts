import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { calculateDistanceMeters, calculateDurationMs } from "../src/track-metrics";
import { DEFAULT_DAILY_DATA_GAP_MINUTES, parseDailyData } from "../src/daily-data-parser";
import { dailyDataRawFileName, unixDayStartSeconds } from "../src/daily-data-date";
import { readCoreDailyNotesSettings, shouldFollowCoreDailyNotesSettings } from "../src/daily-notes-config";
import { convertPointForMap, tileUrl } from "../src/coordinate";
import { AMAP_STANDARD_TILE_URL, DEFAULT_MAP_TILE_PRESET_ID, MAP_TILE_PRESETS } from "../src/map-presets";
import type { GpxDailyBannerSettings, ParsedTrack, TrackPoint } from "../src/types";

function row(timestamp: number, lon: number, lat: number): string {
  return [timestamp, lon, lat, 0, 0, 0, 0, 0, 0, 0, 0, 0].join(",");
}

function countPoints(tracks: ParsedTrack[]): number {
  return tracks.reduce((total, track) => total + track.segments.reduce((sum, segment) => sum + segment.points.length, 0), 0);
}

const fixture = [
  row(1_700_000_060, 121.1, 31.1),
  row(1_700_000_000, 121.0, 31.0),
  row(1_700_000_000, 121.9, 31.9),
  row(1_700_002_000, 121.2, 31.2),
  "not,a,track,row",
  row(1_700_002_060, 121.3, 31.3),
  row(1_700_002_120, 181, 31.4)
].join("\r\n");

const parsed = parseDailyData(`\uFEFF${fixture}`, DEFAULT_DAILY_DATA_GAP_MINUTES);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].name, "一生足迹");
assert.equal(countPoints(parsed), 4);
assert.deepEqual(parsed[0].segments.map((segment) => segment.points.length), [2, 2]);
assert.equal(parsed[0].segments[0].points[0].lon, 121.0);
assert.equal(parsed[0].segments[1].points[1].lat, 31.3);
assert.equal(parsed[0].startTime?.getTime(), 1_700_000_000_000);
assert.equal(parsed[0].endTime?.getTime(), 1_700_002_060_000);

const timezoneSettings = {
  timezoneMode: "offset",
  customTimezoneOffsetMinutes: 480
} as GpxDailyBannerSettings;
assert.equal(unixDayStartSeconds("2026-07-23", timezoneSettings), 1_784_736_000);
assert.equal(unixDayStartSeconds("2026-07-24", timezoneSettings), 1_784_822_400);
assert.equal(dailyDataRawFileName("2026-07-24", timezoneSettings), "1784822400_raw");
assert.equal(1_784_822_400 - 1_784_736_000, 86_400);

const coreDailyNotes = readCoreDailyNotesSettings({
  internalPlugins: {
    getEnabledPluginById: (id: string) => id === "daily-notes"
      ? { instance: { options: { folder: "Journal", format: "YYYY/MM/YYYY-MM-DD", extension: "md" } } }
      : undefined
  }
} as never);
assert.deepEqual(coreDailyNotes, { folder: "Journal", format: "YYYY/MM/YYYY-MM-DD", extension: "md" });
assert.equal(readCoreDailyNotesSettings({ internalPlugins: {} } as never), undefined);
const defaultDailyNotes = { folder: "Daily Notes", format: "YYYY-MM-DD", extension: "md" };
assert.equal(shouldFollowCoreDailyNotesSettings(undefined, defaultDailyNotes), true);
assert.equal(shouldFollowCoreDailyNotesSettings({ dailyNoteFolder: "Daily Notes", dailyNoteDateFormat: "YYYY-MM-DD", dailyNoteExtension: "md" }, defaultDailyNotes), true);
assert.equal(shouldFollowCoreDailyNotesSettings({ dailyNoteFolder: "Personal Journal" }, defaultDailyNotes), false);
assert.equal(shouldFollowCoreDailyNotesSettings({ useCoreDailyNotesSettings: false, dailyNoteFolder: "Daily Notes" }, defaultDailyNotes), false);

assert.equal(DEFAULT_MAP_TILE_PRESET_ID, "amap-standard");
assert.ok(MAP_TILE_PRESETS.some((preset) => preset.id === "amap-standard"));
assert.equal(AMAP_STANDARD_TILE_URL, "https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&x={x}&y={y}&z={z}&size=1&scl=1&style=8");
assert.ok(!AMAP_STANDARD_TILE_URL.includes("ltype=11"));
assert.ok(MAP_TILE_PRESETS.some((preset) => preset.id === "tencent-satellite"));
assert.ok(MAP_TILE_PRESETS.some((preset) => preset.id === "tianditu-vector" && preset.requiresToken));
assert.equal(
  tileUrl("https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}", 14, 13532, 6660, {
    subdomains: ["1", "2", "3", "4"],
    tileYMode: "xyz"
  }),
  "https://wprd01.is.autonavi.com/appmaptile?x=13532&y=6660&z=14"
);
assert.equal(
  tileUrl("https://p{s}.map.gtimg.com/sateTiles/{z}/{sx}/{sy}/{x}_{reverseY}.jpg", 14, 13532, 6660, {
    subdomains: ["0", "1", "2"],
    tileYMode: "tencent"
  }),
  "https://p2.map.gtimg.com/sateTiles/14/845/607/13532_9723.jpg"
);
const outsideChinaPoint = { lat: 51.5074, lon: -0.1278 };
assert.deepEqual(convertPointForMap(outsideChinaPoint, "wgs84", "gcj02"), outsideChinaPoint);
const domesticPoint = { lat: 39.9042, lon: 116.4074 };
const domesticGcj02 = convertPointForMap(domesticPoint, "wgs84", "gcj02");
assert.notEqual(domesticGcj02.lat, domesticPoint.lat);
assert.notEqual(domesticGcj02.lon, domesticPoint.lon);
const domesticRoundTrip = convertPointForMap(domesticGcj02, "gcj02", "wgs84");
assert.ok(Math.abs(domesticRoundTrip.lat - domesticPoint.lat) < 0.00001);
assert.ok(Math.abs(domesticRoundTrip.lon - domesticPoint.lon) < 0.00001);

const metricPoint = (lat: number, lon: number, timestamp: number): TrackPoint => ({ lat, lon, time: new Date(timestamp) });
const segmentedTrack: ParsedTrack[] = [{
  segments: [
    { points: [metricPoint(0, 0, 1_700_000_000_000), metricPoint(0, 0.01, 1_700_000_060_000)] },
    { points: [metricPoint(1, 1, 1_700_007_200_000), metricPoint(1, 1.01, 1_700_007_260_000)] }
  ]
}];
const distance = calculateDistanceMeters(segmentedTrack);
assert.ok(distance > 2_000 && distance < 3_000, `unexpected segmented distance: ${distance}`);
assert.equal(calculateDurationMs(segmentedTrack), 7_260_000);

const rawPath = "D:/桌面/1784822400_raw.csv";
if (existsSync(rawPath)) {
  const rawText = readFileSync(rawPath, "utf8");
  assert.equal(rawText.split(/\r\n?|\n/).filter((line) => line.trim()).length, 113);
  const rawParsed = parseDailyData(rawText);
  assert.equal(countPoints(rawParsed), 113);
  assert.equal(rawParsed[0].segments.length, 4);

  const cleanPath = "D:/桌面/1784822400_clean.csv";
  if (existsSync(cleanPath)) {
    const cleanText = readFileSync(cleanPath, "utf8");
    assert.equal(cleanText.split(/\r\n?|\n/).filter((line) => line.trim()).length, 102);
    assert.notEqual(cleanText, rawText);
  }
}

console.log("daily-data parser, source-date, metric, and supplied-raw checks passed");
