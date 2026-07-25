import { ParsedTrack, TrackPoint, TrackSegment } from "./types";

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export function collectBounds(tracks: ParsedTrack[]): Bounds {
  const points = tracks.flatMap((track) => track.segments).flatMap((segment) => segment.points);
  return {
    minLat: Math.min(...points.map((point) => point.lat)),
    maxLat: Math.max(...points.map((point) => point.lat)),
    minLon: Math.min(...points.map((point) => point.lon)),
    maxLon: Math.max(...points.map((point) => point.lon))
  };
}

export function centerOfBounds(bounds: Bounds): TrackPoint {
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lon: (bounds.minLon + bounds.maxLon) / 2
  };
}

export function lonLatToWorldPixel(lat: number, lon: number, zoom: number): PixelPoint {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const scale = 256 * 2 ** zoom;
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  };
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
  const subdomains = ["a", "b", "c", "d"];
  const subdomain = subdomains[Math.abs(x + y) % subdomains.length];
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{s}", subdomain)
    .replace("{r}", "");
}

function perpendicularDistance(point: TrackPoint, start: TrackPoint, end: TrackPoint): number {
  const dx = end.lon - start.lon;
  const dy = end.lat - start.lat;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.lon - start.lon, point.lat - start.lat);
  }
  const t = ((point.lon - start.lon) * dx + (point.lat - start.lat) * dy) / (dx * dx + dy * dy);
  const projection = {
    lon: start.lon + t * dx,
    lat: start.lat + t * dy
  };
  return Math.hypot(point.lon - projection.lon, point.lat - projection.lat);
}

function douglasPeucker(points: TrackPoint[], epsilon: number): TrackPoint[] {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= epsilon) return [start, end];
  const left = douglasPeucker(points.slice(0, index + 1), epsilon);
  const right = douglasPeucker(points.slice(index), epsilon);
  return left.slice(0, -1).concat(right);
}

export function simplifySegment(segment: TrackSegment, targetPoints: number): TrackSegment {
  if (segment.points.length <= targetPoints) return segment;
  let epsilon = 0.00001;
  let simplified = segment.points;
  for (let attempt = 0; attempt < 16; attempt++) {
    simplified = douglasPeucker(segment.points, epsilon);
    if (simplified.length <= targetPoints) break;
    epsilon *= 1.6;
  }
  if (simplified.length > targetPoints) {
    const step = Math.ceil(simplified.length / targetPoints);
    const sampled = simplified.filter((_, index) => index % step === 0);
    if (sampled[0] !== simplified[0]) sampled.unshift(simplified[0]);
    if (sampled[sampled.length - 1] !== simplified[simplified.length - 1]) sampled.push(simplified[simplified.length - 1]);
    simplified = sampled;
  }
  return { points: simplified };
}

export function simplifyTracks(tracks: ParsedTrack[], maxPoints = 5000): ParsedTrack[] {
  const segments = tracks.flatMap((track) => track.segments);
  const total = segments.reduce((sum, segment) => sum + segment.points.length, 0);
  if (total <= maxPoints) return tracks;
  const ratio = maxPoints / total;
  return tracks.map((track) => ({
    ...track,
    segments: track.segments.map((segment) => simplifySegment(segment, Math.max(2, Math.floor(segment.points.length * ratio))))
  }));
}
