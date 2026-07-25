import { Notice } from "obsidian";
import { ParsedTrack, TrackPoint, TrackSegment } from "./types";

function childrenByLocalName(element: Element | Document, localName: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName.toLowerCase() === localName.toLowerCase());
}

function descendantsByLocalName(element: Element | Document, localName: string): Element[] {
  return Array.from(element.getElementsByTagName("*")).filter((child) => child.localName.toLowerCase() === localName.toLowerCase());
}

function firstChildText(element: Element, localName: string): string | undefined {
  const child = childrenByLocalName(element, localName)[0];
  const text = child?.textContent?.trim();
  return text || undefined;
}

function parsePoint(element: Element): TrackPoint | null {
  const lat = Number.parseFloat(element.getAttribute("lat") ?? "");
  const lon = Number.parseFloat(element.getAttribute("lon") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const elevationText = firstChildText(element, "ele");
  const timeText = firstChildText(element, "time");
  const point: TrackPoint = { lat, lon };
  if (elevationText !== undefined) {
    const elevation = Number.parseFloat(elevationText);
    if (Number.isFinite(elevation)) point.elevation = elevation;
  }
  if (timeText) {
    const time = new Date(timeText);
    if (!Number.isNaN(time.getTime())) point.time = time;
  }
  return point;
}

function timesFromSegments(segments: TrackSegment[]): Date[] {
  return segments.flatMap((segment) => segment.points.map((point) => point.time).filter((time): time is Date => Boolean(time)));
}

function trackFromElement(trackElement: Element): ParsedTrack | null {
  const segments = childrenByLocalName(trackElement, "trkseg")
    .map((segmentElement) => ({
      points: childrenByLocalName(segmentElement, "trkpt").map(parsePoint).filter((point): point is TrackPoint => Boolean(point))
    }))
    .filter((segment) => segment.points.length > 0);

  const times = timesFromSegments(segments).sort((a, b) => a.getTime() - b.getTime());
  return segments.length
    ? {
        name: firstChildText(trackElement, "name"),
        segments,
        startTime: times[0],
        endTime: times[times.length - 1]
      }
    : null;
}

function routeFromElement(routeElement: Element): ParsedTrack | null {
  const points = childrenByLocalName(routeElement, "rtept").map(parsePoint).filter((point): point is TrackPoint => Boolean(point));
  if (!points.length) return null;
  const times = points.map((point) => point.time).filter((time): time is Date => Boolean(time)).sort((a, b) => a.getTime() - b.getTime());
  return {
    name: firstChildText(routeElement, "name"),
    segments: [{ points }],
    startTime: times[0],
    endTime: times[times.length - 1]
  };
}

export function parseGpx(xml: string): ParsedTrack[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const parserError = descendantsByLocalName(doc, "parsererror")[0];
  if (parserError) {
    throw new Error("GPX XML 无法解析。");
  }

  const tracks = descendantsByLocalName(doc, "trk").map(trackFromElement).filter((track): track is ParsedTrack => Boolean(track));
  if (tracks.some((track) => track.segments.some((segment) => segment.points.length >= 2))) {
    return tracks;
  }

  const routes = descendantsByLocalName(doc, "rte").map(routeFromElement).filter((track): track is ParsedTrack => Boolean(track));
  if (routes.some((track) => track.segments.some((segment) => segment.points.length >= 2))) {
    return routes;
  }

  throw new Error("GPX 中没有足够的有效轨迹点。");
}

export function getMetadataTime(xml: string): Date | undefined {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const metadata = descendantsByLocalName(doc, "metadata")[0];
    if (!metadata) return undefined;
    const timeText = firstChildText(metadata, "time");
    if (!timeText) return undefined;
    const time = new Date(timeText);
    return Number.isNaN(time.getTime()) ? undefined : time;
  } catch (error) {
    new Notice("读取 GPX metadata 时间失败，已继续使用其他日期来源。");
    return undefined;
  }
}
