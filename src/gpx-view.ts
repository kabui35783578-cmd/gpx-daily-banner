import { Notice, TFile, TextFileView, WorkspaceLeaf } from "obsidian";
import { dailyNotePathForDate } from "./daily-note";
import { parseGpx, getMetadataTime } from "./gpx-parser";
import { bannerImagePath } from "./image-storage";
import type GpxDailyBannerPlugin from "./main";
import { resolveTrackDate } from "./track-date";
import { calculateDistanceMeters, calculateDurationMs, countTrackPoints } from "./track-metrics";
import { ParsedTrack } from "./types";
import { formatDistance, formatDuration } from "./utils";

export const GPX_VIEW_TYPE = "gpx-daily-banner-preview";

export class GpxPreviewView extends TextFileView {
  private plugin: GpxDailyBannerPlugin;
  private source = "";

  constructor(leaf: WorkspaceLeaf, plugin: GpxDailyBannerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return GPX_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "GPX";
  }

  getIcon(): string {
    return "route";
  }

  getViewData(): string {
    return this.source;
  }

  setViewData(data: string, clear: boolean): void {
    this.source = data;
    if (clear) {
      this.clear();
    }
    void this.render();
  }

  clear(): void {
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    const file = this.file;
    const root = this.contentEl;
    root.empty();
    root.addClass("gpx-preview-view");

    if (!(file instanceof TFile)) {
      this.renderEmpty(root, "未选择 GPX 文件");
      return;
    }

    let tracks: ParsedTrack[];
    try {
      tracks = parseGpx(this.source);
    } catch (error) {
      this.renderError(root, file, error instanceof Error ? error.message : "GPX 无法解析。");
      return;
    }

    const settings = this.plugin.settings;
    const { dateKey } = resolveTrackDate(file, tracks, getMetadataTime(this.source), settings);
    const notePath = dailyNotePathForDate(dateKey, settings);
    const distance = calculateDistanceMeters(tracks);
    const duration = calculateDurationMs(tracks);
    const pointCount = countTrackPoints(tracks);
    const segmentCount = tracks.reduce((sum, track) => sum + track.segments.length, 0);
    const record = this.plugin.data.records[file.path];
    const expectedImagePath = bannerImagePath(dateKey, settings);
    const previewImagePath = record?.imagePath || expectedImagePath;
    const bannerImage = this.app.vault.getAbstractFileByPath(previewImagePath);
    const hasBannerImage = bannerImage instanceof TFile;

    const header = root.createDiv({ cls: "gpx-preview-header" });
    const titleWrap = header.createDiv({ cls: "gpx-preview-title-wrap" });
    titleWrap.createEl("div", { text: "GPX Track", cls: "gpx-preview-kicker" });
    titleWrap.createEl("h1", { text: file.basename, cls: "gpx-preview-title" });
    titleWrap.createEl("div", { text: file.path, cls: "gpx-preview-path" });

    const statusClass = hasBannerImage ? "is-processed" : record?.status ? `is-${record.status}` : "is-new";
    const status = header.createDiv({ cls: `gpx-preview-status ${statusClass}` });
    status.setText(hasBannerImage ? "已生成封面" : record?.status === "pending-note" ? "等待日记" : record?.status === "failed" ? "处理失败" : "未处理");

    if (hasBannerImage) {
      root.createEl("img", {
        cls: "gpx-preview-banner-image",
        attr: {
          src: this.app.vault.getResourcePath(bannerImage),
          alt: `${file.basename} GPX map preview`
        }
      });
    } else {
      const missing = root.createDiv({ cls: "gpx-preview-missing-banner" });
      missing.createEl("strong", { text: "还没有生成封面图片" });
      missing.createEl("span", { text: "GPX 预览不会单独加载在线地图。生成一次封面后，这里会直接显示本地 PNG。" });
    }

    const metrics = root.createDiv({ cls: "gpx-preview-metrics" });
    metric(metrics, "日期", dateKey);
    metric(metrics, "距离", formatDistance(distance) ?? "-");
    metric(metrics, "时长", formatDuration(duration) ?? "-");
    metric(metrics, "点数", String(pointCount));
    metric(metrics, "轨迹段", String(segmentCount));
    metric(metrics, "日记", notePath);

    const actions = root.createDiv({ cls: "gpx-preview-actions" });
    const generate = actions.createEl("button", { text: "使用此 GPX 覆盖封面", cls: "mod-cta" });
    generate.onclick = async () => {
      if (!(this.file instanceof TFile)) return;
      await this.plugin.manager.processGpxFile(this.file, { force: true, skipStabilityCheck: true });
      await this.render();
    };

    const openNote = actions.createEl("button", { text: "打开对应日记" });
    openNote.onclick = async () => {
      const note = this.app.vault.getAbstractFileByPath(notePath);
      if (note instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(note);
      } else {
        new Notice(`没有找到日记：${notePath}`);
      }
    };

    if (hasBannerImage) {
      const openImage = actions.createEl("button", { text: "打开封面图片" });
      openImage.onclick = async () => {
        await this.app.workspace.getLeaf(false).openFile(bannerImage);
      };
    }
  }

  private renderEmpty(root: HTMLElement, message: string): void {
    root.createDiv({ text: message, cls: "gpx-preview-empty" });
  }

  private renderError(root: HTMLElement, file: TFile, message: string): void {
    const panel = root.createDiv({ cls: "gpx-preview-error" });
    panel.createEl("h1", { text: file.basename });
    panel.createEl("p", { text: message });
  }
}

function metric(parent: HTMLElement, label: string, value: string): void {
  const item = parent.createDiv({ cls: "gpx-preview-metric" });
  item.createEl("span", { text: label, cls: "gpx-preview-metric-label" });
  item.createEl("strong", { text: value, cls: "gpx-preview-metric-value" });
}
