import { centerOfBounds, collectBounds } from "./coordinate";
import { GpxDailyBannerSettings, RenderInput } from "./types";
import { canvasToArrayBuffer, formatDistance, formatDuration } from "./utils";

export async function renderOfflineBanner(input: RenderInput, settings: GpxDailyBannerSettings, reason?: string): Promise<ArrayBuffer> {
  const canvas = document.createElement("canvas");
  canvas.width = settings.imageWidth;
  canvas.height = settings.imageHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持 Canvas。");

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#f7fafc");
  gradient.addColorStop(1, "#dbeafe");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(30, 64, 175, 0.12)";
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  const bounds = collectBounds(input.tracks);
  const padding = 80;
  const lonSpan = Math.max(0.000001, bounds.maxLon - bounds.minLon);
  const latSpan = Math.max(0.000001, bounds.maxLat - bounds.minLat);
  const scale = Math.min((canvas.width - padding * 2) / lonSpan, (canvas.height - padding * 2) / latSpan);
  const center = centerOfBounds(bounds);
  const project = (lat: number, lon: number) => ({
    x: canvas.width / 2 + (lon - center.lon) * scale,
    y: canvas.height / 2 - (lat - center.lat) * scale
  });

  input.tracks.forEach((track, trackIndex) => {
    ctx.strokeStyle = settings.trackColors[trackIndex % settings.trackColors.length] ?? settings.trackColor;
    ctx.lineWidth = settings.trackLineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const segment of track.segments) {
      if (segment.points.length < 2) continue;
      ctx.beginPath();
      segment.points.forEach((point, index) => {
        const pixel = project(point.lat, point.lon);
        if (index === 0) ctx.moveTo(pixel.x, pixel.y);
        else ctx.lineTo(pixel.x, pixel.y);
      });
      ctx.stroke();
    }
  });

  const allSegments = input.tracks.flatMap((track) => track.segments).filter((segment) => segment.points.length > 0);
  const first = allSegments[0]?.points[0];
  const lastSegment = allSegments[allSegments.length - 1];
  const last = lastSegment?.points[lastSegment.points.length - 1];
  drawMarker(ctx, first ? project(first.lat, first.lon) : undefined, "#22c55e", settings.showStartMarker);
  drawMarker(ctx, last ? project(last.lat, last.lon) : undefined, "#ef4444", settings.showEndMarker);

  drawOverlay(ctx, input, settings, reason ?? "地图底图加载失败");
  return canvasToArrayBuffer(canvas);
}

function drawMarker(ctx: CanvasRenderingContext2D, point: { x: number; y: number } | undefined, color: string, enabled: boolean): void {
  if (!enabled || !point) return;
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawOverlay(ctx: CanvasRenderingContext2D, input: RenderInput, settings: GpxDailyBannerSettings, reason: string): void {
  const lines = [
    settings.showDate ? input.stats.dateLabel : undefined,
    settings.showDistance ? formatDistance(input.stats.distanceMeters) : undefined,
    settings.showDuration ? formatDuration(input.stats.durationMs) : undefined,
    reason
  ].filter((line): line is string => Boolean(line));

  ctx.font = "600 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textBaseline = "top";
  const maxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 200);
  const x = 32;
  const y = 32;
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  roundRect(ctx, x - 16, y - 14, maxWidth + 32, lines.length * 36 + 28, 18);
  ctx.fill();
  lines.forEach((line, index) => {
    ctx.fillStyle = index === lines.length - 1 ? "#475569" : "#0f172a";
    ctx.fillText(line, x, y + index * 36);
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
