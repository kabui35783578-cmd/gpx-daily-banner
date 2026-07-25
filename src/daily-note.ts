import { Notice, TFile, Vault } from "obsidian";
import { GpxDailyBannerSettings } from "./types";
import { BANNER_END, BANNER_START, cleanFilePath, ensureFolder, joinPath, parentFolder } from "./utils";

export function dailyNotePathForDate(dateKey: string, settings: GpxDailyBannerSettings): string {
  const formatted = settings.dailyNoteDateFormat
    .replace(/YYYY/g, dateKey.slice(0, 4))
    .replace(/MM/g, dateKey.slice(5, 7))
    .replace(/DD/g, dateKey.slice(8, 10));
  return cleanFilePath(joinPath(settings.dailyNoteFolder, `${formatted}.${settings.dailyNoteExtension.replace(/^\./, "")}`));
}

export async function getOrCreateDailyNote(vault: Vault, dateKey: string, settings: GpxDailyBannerSettings): Promise<TFile | null> {
  const path = dailyNotePathForDate(dateKey, settings);
  const existing = vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;
  if (!settings.autoCreateDailyNote) {
    new Notice(`没有找到日记：${path}`);
    return null;
  }
  try {
    await ensureFolder(vault, parentFolder(path));
    return await vault.create(path, "");
  } catch (error) {
    new Notice(`日记创建失败：${path}`);
    throw error;
  }
}

export async function upsertBannerBlock(vault: Vault, note: TFile, imagePath: string): Promise<void> {
  const block = `${BANNER_START}\n![[${imagePath}|gpx-daily-banner]]\n${BANNER_END}`;
  await vault.process(note, (content) => {
    const pattern = new RegExp(`${escapeRegex(BANNER_START)}[\\s\\S]*?${escapeRegex(BANNER_END)}`);
    if (pattern.test(content)) {
      return content.replace(pattern, block);
    }
    const insertIndex = frontmatterEndIndex(content);
    if (insertIndex > 0) {
      const before = content.slice(0, insertIndex).replace(/\s*$/, "\n\n");
      const after = content.slice(insertIndex).replace(/^\s*/, "");
      return `${before}${block}\n\n${after}`;
    }
    return `${block}\n\n${content.replace(/^\s*/, "")}`;
  });
}

export async function removeBannerBlock(vault: Vault, note: TFile): Promise<boolean> {
  let removed = false;
  await vault.process(note, (content) => {
    const pattern = new RegExp(`\\n?${escapeRegex(BANNER_START)}[\\s\\S]*?${escapeRegex(BANNER_END)}\\n?`, "m");
    if (!pattern.test(content)) return content;
    removed = true;
    return content.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  });
  return removed;
}

export function extractBannerImagePath(content: string): string | undefined {
  const pattern = new RegExp(`${escapeRegex(BANNER_START)}[\\s\\S]*?!\\[\\[([^|\\]]+)(?:\\|[^\\]]*)?\\]\\][\\s\\S]*?${escapeRegex(BANNER_END)}`);
  return content.match(pattern)?.[1];
}

function frontmatterEndIndex(content: string): number {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? match[0].length : 0;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
