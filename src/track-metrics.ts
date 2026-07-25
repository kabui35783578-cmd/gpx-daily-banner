import { ParsedTrack, TrackPoint } from "./types";

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineMeters(a: TrackPoint, b: TrackPoint): number {
  const radius = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function calculateDistanceMeters(tracks: ParsedTrack[]): number {
  let total = 0;
  for (const track of tracks) {
    for (const segment of track.segments) {
      for (let index = 1; index < segment.points.length; index++) {
        total += haversineMeters(segment.points[index - 1], segment.points[index]);
      }
    }
  }
  return total;
}

export function calculateDurationMs(tracks: ParsedTrack[]): number | undefined {
  const times = tracks
    .flatMap((track) => track.segments)
    .flatMap((segment) => segment.points)
    .map((point) => point.time)
    .filter((time): time is Date => Boolean(time))
    .map((time) => time.getTime())
    .sort((a, b) => a - b);
  if (times.length < 2) return undefined;
  return Math.max(0, times[times.length - 1] - times[0]);
}

export function allTrackPoints(tracks: ParsedTrack[]): TrackPoint[] {
  return tracks.flatMap((track) => track.segments).flatMap((segment) => segment.points);
}

export function countTrackPoints(tracks: ParsedTrack[]): number {
  return allTrackPoints(tracks).length;
}
