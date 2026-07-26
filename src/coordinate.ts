import { MapCoordinateSystem, ParsedTrack, TileYMode, TrackPoint, TrackSegment } from "./types";

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

export interface TileUrlOptions {
  subdomains?: readonly string[];
  tileYMode?: TileYMode;
  token?: string;
}

export function tileUrl(template: string, z: number, x: number, y: number, options: TileUrlOptions = {}): string {
  const subdomains = options.subdomains?.length ? options.subdomains : ["a", "b", "c", "d"];
  const tileY = options.tileYMode === "tencent" ? 2 ** z - 1 - y : y;
  const subdomain = subdomains[Math.abs(x + tileY) % subdomains.length];
  const x16 = Math.floor(x / 16);
  const y16 = Math.floor(tileY / 16);
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{s}", subdomain)
    .replace("{r}", "")
    .replace("{reverseY}", String(tileY))
    .replace("{sx}", String(x16))
    .replace("{sy}", String(y16))
    .replace("{token}", options.token ?? "");
}

const GCJ_PI = Math.PI;
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

export function convertTracksForMap(tracks: ParsedTrack[], from: MapCoordinateSystem, to: MapCoordinateSystem): ParsedTrack[] {
  if (from === to) return tracks;
  return tracks.map((track) => ({
    ...track,
    segments: track.segments.map((segment) => ({
      ...segment,
      points: segment.points.map((point) => convertPointForMap(point, from, to))
    }))
  }));
}

export function convertPointForMap(point: TrackPoint, from: MapCoordinateSystem, to: MapCoordinateSystem): TrackPoint {
  if (from === to) return { ...point };
  if (from === "wgs84" && to === "gcj02") return wgs84ToGcj02(point);
  return gcj02ToWgs84(point);
}

export function wgs84ToGcj02(point: TrackPoint): TrackPoint {
  if (isOutsideChina(point.lat, point.lon)) return { ...point };
  const dLat = transformLatitude(point.lon - 105, point.lat - 35);
  const dLon = transformLongitude(point.lon - 105, point.lat - 35);
  const radLat = (point.lat / 180) * GCJ_PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const lat = point.lat + (dLat * 180) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * GCJ_PI);
  const lon = point.lon + (dLon * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * GCJ_PI);
  return { ...point, lat, lon };
}

export function gcj02ToWgs84(point: TrackPoint): TrackPoint {
  if (isOutsideChina(point.lat, point.lon)) return { ...point };
  const converted = wgs84ToGcj02(point);
  return {
    ...point,
    lat: point.lat * 2 - converted.lat,
    lon: point.lon * 2 - converted.lon
  };
}

function isOutsideChina(lat: number, lon: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLatitude(x: number, y: number): number {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += (20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2 / 3;
  result += (20 * Math.sin(y * GCJ_PI) + 40 * Math.sin((y / 3) * GCJ_PI)) * 2 / 3;
  result += (160 * Math.sin((y / 12) * GCJ_PI) + 320 * Math.sin((y * GCJ_PI) / 30)) * 2 / 3;
  return result;
}

function transformLongitude(x: number, y: number): number {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += (20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2 / 3;
  result += (20 * Math.sin(x * GCJ_PI) + 40 * Math.sin((x / 3) * GCJ_PI)) * 2 / 3;
  result += (150 * Math.sin((x / 12) * GCJ_PI) + 300 * Math.sin((x / 30) * GCJ_PI)) * 2 / 3;
  return result;
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
