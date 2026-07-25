import { ParsedTrack, TrackPoint, TrackSegment } from "./types";

export const DEFAULT_DAILY_DATA_GAP_MINUTES = 30;

const MILLISECONDS_THRESHOLD = 1_000_000_000_000;

/**
 * Parse the headerless 12-column location rows exported by 一生足迹.
 *
 * Only the first three columns are part of the route contract:
 * timestamp (Unix seconds), longitude, and latitude. The remaining sensor
 * columns are intentionally ignored so the parser stays small and resilient
 * to changes in their meaning.
 */
export function parseDailyData(text: string, gapMinutes = DEFAULT_DAILY_DATA_GAP_MINUTES): ParsedTrack[] {
  const points = parsePoints(text);
  if (!points.length) {
    throw new Error("一生足迹文件中没有有效的轨迹点。");
  }

  const gapMilliseconds = Math.max(0, Number.isFinite(gapMinutes) ? gapMinutes : DEFAULT_DAILY_DATA_GAP_MINUTES) * 60 * 1000;
  const segments: TrackSegment[] = [];
  let current: TrackPoint[] = [];
  let previousTime: number | undefined;

  for (const point of points) {
    const currentTime = point.time?.getTime();
    if (current.length && currentTime !== undefined && previousTime !== undefined && currentTime - previousTime > gapMilliseconds) {
      segments.push({ points: current });
      current = [];
    }
    current.push(point);
    previousTime = currentTime;
  }
  if (current.length) {
    segments.push({ points: current });
  }

  return [
    {
      name: "一生足迹",
      segments,
      startTime: points[0].time,
      endTime: points[points.length - 1].time
    }
  ];
}

function parsePoints(text: string): TrackPoint[] {
  const rows = text.replace(/^\uFEFF/, "").split(/\r\n?|\n/);
  const points: TrackPoint[] = [];
  const timestamps = new Set<number>();

  for (const row of rows) {
    if (!row.trim()) continue;
    const fields = row.split(",");
    if (fields.length < 3) continue;

    const timestampValue = Number.parseFloat(fields[0].trim());
    const lon = Number.parseFloat(fields[1].trim());
    const lat = Number.parseFloat(fields[2].trim());
    if (!Number.isFinite(timestampValue) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const timestampMilliseconds = Math.abs(timestampValue) >= MILLISECONDS_THRESHOLD ? timestampValue : timestampValue * 1000;
    const time = new Date(timestampMilliseconds);
    if (Number.isNaN(time.getTime())) continue;

    const timestamp = time.getTime();
    if (timestamps.has(timestamp)) continue;
    timestamps.add(timestamp);
    points.push({ lat, lon, time });
  }

  points.sort((a, b) => (a.time?.getTime() ?? 0) - (b.time?.getTime() ?? 0));
  return points;
}
