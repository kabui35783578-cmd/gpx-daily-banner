import type { PluginData, ProcessedFileRecord } from "./types";

export function latestManualRecord(data: PluginData, dateKey: string): ProcessedFileRecord | undefined {
  if (Object.prototype.hasOwnProperty.call(data.manualOverrides ?? {}, dateKey)) {
    const selectedPath = data.manualOverrides?.[dateKey];
    return selectedPath ? data.records[selectedPath] : undefined;
  }
  return Object.values(data.records)
    .filter((record) => record.trackDate === dateKey && record.status === "processed")
    .sort((a, b) => (b.processedAt ?? b.modifiedTime) - (a.processedAt ?? a.modifiedTime))[0];
}

export function hasManualOverride(data: PluginData, dateKey: string): boolean {
  return Boolean(data.manualOverrides?.[dateKey] || latestManualRecord(data, dateKey));
}
