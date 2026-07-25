import type { App } from "obsidian";

export interface CoreDailyNotesSettings {
  folder?: string;
  format?: string;
  extension?: string;
}

export interface DailyNotesDefaults {
  folder: string;
  format: string;
  extension: string;
}

interface UnknownRecord {
  [key: string]: unknown;
}

interface InternalDailyNotesPlugin {
  instance?: UnknownRecord;
  options?: UnknownRecord;
  settings?: UnknownRecord;
}

interface InternalPlugins {
  getEnabledPluginById?: (id: string) => InternalDailyNotesPlugin | undefined;
  getPluginById?: (id: string) => InternalDailyNotesPlugin | undefined;
  plugins?: Record<string, InternalDailyNotesPlugin | undefined>;
}

interface AppWithInternalPlugins extends App {
  internalPlugins?: InternalPlugins;
}

/**
 * Read the best-effort settings exposed by Obsidian's core Daily Notes plugin.
 * This is intentionally isolated behind a small compatibility boundary because
 * internal plugin settings are not part of the public plugin API.
 */
export function readCoreDailyNotesSettings(app: App): CoreDailyNotesSettings | undefined {
  const internalPlugins = (app as AppWithInternalPlugins).internalPlugins;
  if (!internalPlugins) return undefined;

  const plugin =
    internalPlugins.getEnabledPluginById?.("daily-notes") ??
    internalPlugins.getPluginById?.("daily-notes") ??
    internalPlugins.plugins?.["daily-notes"];
  if (!plugin) return undefined;

  const options = (plugin.instance?.options ?? plugin.options ?? plugin.instance?.settings ?? plugin.settings) as UnknownRecord | undefined;
  if (!options) return undefined;

  const folder = readString(options, "folder") ?? readString(options, "dailyNoteFolder");
  const format = readString(options, "format") ?? readString(options, "dailyNoteFormat");
  const extension = readString(options, "extension") ?? readString(options, "dailyNoteExtension");
  if (folder === undefined && format === undefined && extension === undefined) return undefined;

  return { folder, format, extension };
}

/**
 * Preserve an existing user's explicit path when upgrading from a version
 * that did not have the follow-core setting. New installs still follow the
 * core Daily Notes plugin by default.
 */
export function shouldFollowCoreDailyNotesSettings(loaded: unknown, defaults: DailyNotesDefaults): boolean {
  if (!loaded || typeof loaded !== "object") return true;
  const record = loaded as UnknownRecord;
  const explicit = record.useCoreDailyNotesSettings;
  if (typeof explicit === "boolean") return explicit;

  const hasLegacyDailyNoteSettings = ["dailyNoteFolder", "dailyNoteDateFormat", "dailyNoteExtension"].some((key) => Object.prototype.hasOwnProperty.call(record, key));
  if (!hasLegacyDailyNoteSettings) return true;

  const folder = typeof record.dailyNoteFolder === "string" ? record.dailyNoteFolder : defaults.folder;
  const format = typeof record.dailyNoteDateFormat === "string" ? record.dailyNoteDateFormat : defaults.format;
  const extension = typeof record.dailyNoteExtension === "string" ? record.dailyNoteExtension.replace(/^\./, "") : defaults.extension;
  return folder === defaults.folder && format === defaults.format && extension === defaults.extension;
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
