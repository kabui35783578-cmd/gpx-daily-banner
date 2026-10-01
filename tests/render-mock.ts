import type { GpxDailyBannerSettings, RenderInput } from "../src/types";
export const renders: string[] = [];
export let onRender: ((input: RenderInput, settings: GpxDailyBannerSettings) => Promise<void>) | undefined;
export function setOnRender(callback?: typeof onRender) { onRender = callback; }
export async function renderMapBanner(input: RenderInput, settings: GpxDailyBannerSettings) {
  renders.push(`${input.tracks[0].name}:${settings.imageWidth}x${settings.imageHeight}`);
  await onRender?.(input, settings);
  return new TextEncoder().encode(input.tracks[0].name).buffer;
}
export const renderOfflineBanner = renderMapBanner;
export function parseGpx(xml: string) {
  if (xml === "invalid") throw new Error("invalid GPX");
  return [{ name: xml, segments: [{ points: [{ lat: 31, lon: 121 }, { lat: 31.01, lon: 121.01 }] }] }];
}
export function getMetadataTime() { return new Date("2026-07-24T10:00:00Z"); }
