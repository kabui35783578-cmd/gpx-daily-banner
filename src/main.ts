import { App, Modal, Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { BannerManager } from "./banner-manager";
import { readCoreDailyNotesSettings, shouldFollowCoreDailyNotesSettings } from "./daily-notes-config";
import { extractBannerImagePath, removeBannerBlock } from "./daily-note";
import { GPX_VIEW_TYPE, GpxPreviewView } from "./gpx-view";
import { inferMapTilePresetId } from "./map-presets";
import { DEFAULT_SETTINGS, GpxDailyBannerSettingTab } from "./settings";
import { todayKey } from "./track-date";
import { GpxDailyBannerSettings, PluginData } from "./types";
import { BANNER_END, BANNER_START, cleanFolderPath, debug, isGpxFile, isTFile, replaceCssVariables } from "./utils";

export default class GpxDailyBannerPlugin extends Plugin {
  settings: GpxDailyBannerSettings = { ...DEFAULT_SETTINGS };
  data: PluginData = { records: {}, dailyDataRecords: {} };
  manager!: BannerManager;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadPluginData();
    this.applyStyleVariables();

    this.manager = new BannerManager(
      this.app.vault,
      () => this.settings,
      () => this.data,
      () => this.savePluginData()
    );

    this.addSettingTab(new GpxDailyBannerSettingTab(this.app, this));
    this.registerView(GPX_VIEW_TYPE, (leaf) => new GpxPreviewView(leaf, this));
    this.registerExtensions(["gpx"], GPX_VIEW_TYPE);
    this.registerCommands();
    this.registerBannerMarkerHider();

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          void this.handleCreatedFile(file);
        })
      );

      const startupRefresh = window.setTimeout(() => {
        void this.manager.refreshTodayDailyData().catch((error) => {
          debug(this.settings, "startup daily data refresh failed", error);
        });
      }, this.settings.dailyDataStartupDelaySeconds * 1000);
      this.register(() => window.clearTimeout(startupRefresh));
    });

    debug(this.settings, "loaded");
  }

  onunload(): void {
    debug(this.settings, "unloaded");
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    this.settings.useCoreDailyNotesSettings = shouldFollowCoreDailyNotesSettings(loaded, {
      folder: DEFAULT_SETTINGS.dailyNoteFolder,
      format: DEFAULT_SETTINGS.dailyNoteDateFormat,
      extension: DEFAULT_SETTINGS.dailyNoteExtension
    });
    if (this.settings.dailyDataBridgeFolder === "附件") {
      this.settings.dailyDataBridgeFolder = DEFAULT_SETTINGS.dailyDataBridgeFolder;
    }
    if (this.settings.dailyDataSourceMode !== "external" && this.settings.dailyDataSourceMode !== "bridge") {
      this.settings.dailyDataSourceMode = DEFAULT_SETTINGS.dailyDataSourceMode;
    }
    if (!Number.isFinite(this.settings.dailyDataStartupDelaySeconds)) {
      this.settings.dailyDataStartupDelaySeconds = DEFAULT_SETTINGS.dailyDataStartupDelaySeconds;
    } else {
      this.settings.dailyDataStartupDelaySeconds = Math.max(0, Math.min(60, Math.round(this.settings.dailyDataStartupDelaySeconds)));
    }
    if (typeof this.settings.useCoreDailyNotesSettings !== "boolean") {
      this.settings.useCoreDailyNotesSettings = DEFAULT_SETTINGS.useCoreDailyNotesSettings;
    }
    if (typeof this.settings.onlineMapEnabled !== "boolean") {
      this.settings.onlineMapEnabled = DEFAULT_SETTINGS.onlineMapEnabled;
    }
    if (!loaded?.mapTilePreset) {
      this.settings.mapTilePreset = inferMapTilePresetId(this.settings.tileUrlTemplate);
    }
    this.syncDailyNotesSettingsFromCore();
  }

  async saveSettings(): Promise<void> {
    await this.saveData({
      ...this.settings,
      records: this.data.records,
      dailyDataRecords: this.data.dailyDataRecords
    });
  }

  async loadPluginData(): Promise<void> {
    const loaded = await this.loadData();
    this.data = {
      records: loaded?.records ?? {},
      dailyDataRecords: loaded?.dailyDataRecords ?? {}
    };
  }

  async savePluginData(): Promise<void> {
    await this.saveData({
      ...this.settings,
      records: this.data.records,
      dailyDataRecords: this.data.dailyDataRecords
    });
  }

  applyStyleVariables(): void {
    replaceCssVariables(this.settings);
  }

  syncDailyNotesSettingsFromCore(): boolean {
    if (!this.settings.useCoreDailyNotesSettings) return false;
    const coreSettings = readCoreDailyNotesSettings(this.app);
    if (!coreSettings) return false;

    let changed = false;
    if (coreSettings.folder !== undefined) {
      const folder = cleanFolderPath(coreSettings.folder);
      if (folder !== this.settings.dailyNoteFolder) {
        this.settings.dailyNoteFolder = folder;
        changed = true;
      }
    }
    if (coreSettings.format !== undefined && coreSettings.format !== this.settings.dailyNoteDateFormat) {
      this.settings.dailyNoteDateFormat = coreSettings.format;
      changed = true;
    }
    if (coreSettings.extension !== undefined) {
      const extension = coreSettings.extension.replace(/^\./, "");
      if (extension && extension !== this.settings.dailyNoteExtension) {
        this.settings.dailyNoteExtension = extension;
        changed = true;
      }
    }
    return changed;
  }

  private registerCommands(): void {
    this.addCommand({
      id: "scan-gpx-inbox",
      name: "扫描 GPX 导入文件夹",
      callback: () => {
        void this.manager.scanInbox();
      }
    });

    this.addCommand({
      id: "refresh-today-daily-data",
      name: "重新读取今天文件",
      callback: () => {
        void this.manager.refreshTodayDailyData({ force: true, notifyMissing: true });
      }
    });

    this.addCommand({
      id: "process-current-gpx",
      name: "使用当前 GPX 覆盖日记封面",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = isGpxFile(file);
        if (canRun && !checking && file) {
          void this.manager.processGpxFile(file, { force: true });
        }
        return canRun;
      }
    });

    this.addCommand({
      id: "regenerate-today-banner",
      name: "重新生成今天的轨迹封面",
      callback: () => {
        void this.manager.regenerateForDate(todayKey(this.settings));
      }
    });

    this.addCommand({
      id: "regenerate-all-banners",
      name: "重新生成所有轨迹封面",
      callback: () => {
        void this.regenerateAllBanners("正在重新生成所有轨迹封面。");
      }
    });

    this.addCommand({
      id: "regenerate-current-note-banner",
      name: "重新生成当前日记的轨迹封面",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = isTFile(file) && file.extension === "md";
        if (canRun && !checking && file) {
          const record = Object.values(this.data.records).find((item) => item.notePath === file.path && !item.sourceDeleted);
          const dailyRecord = Object.values(this.data.dailyDataRecords).find((item) => item.notePath === file.path);
          if (record) {
            void this.manager.regenerateForDate(record.trackDate);
          } else if (dailyRecord) {
            void this.manager.regenerateForDate(dailyRecord.dateKey);
          } else {
            new Notice("当前日记没有对应的轨迹处理记录。");
          }
        }
        return canRun;
      }
    });

    this.addCommand({
      id: "clear-current-note-banner",
      name: "清除当前日记的轨迹封面",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = isTFile(file) && file.extension === "md";
        if (canRun && !checking && file) {
          void this.clearCurrentNoteBanner(file);
        }
        return canRun;
      }
    });

    this.addCommand({
      id: "open-gpx-daily-banner-settings",
      name: "打开 GPX Daily Banner 设置",
      callback: () => this.openSettings()
    });
  }

  private registerBannerMarkerHider(): void {
    this.registerMarkdownPostProcessor((element) => {
      hideBannerMarkers(element);
    });

    let pending = false;
    const schedule = () => {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(() => {
        pending = false;
        hideLivePreviewBannerMarkers(document.body);
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.register(() => observer.disconnect());
    this.registerEvent(this.app.workspace.on("layout-change", schedule));
    schedule();
  }

  private async handleCreatedFile(file: TAbstractFile): Promise<void> {
    if (isGpxFile(file)) {
      await this.manager.processGpxFile(file);
      return;
    }
    if (file instanceof TFile && file.extension === "md") {
      await this.manager.retryPendingForNote(file.path);
    }
  }

  private openSettings(): void {
    const setting = (this.app as App & { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
    if (!setting) {
      new Notice("无法打开设置页，请从插件设置中打开 GPX Daily Banner。");
      return;
    }
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  async regenerateAllBanners(startMessage?: string): Promise<void> {
    if (startMessage) {
      new Notice(startMessage);
    }
    const count = await this.manager.regenerateAllProcessed();
    if (count > 0) {
      new Notice(`已重新生成 ${count} 张轨迹封面。`);
    } else {
      new Notice("还没有可重新生成的轨迹封面。");
    }
  }

  private async clearCurrentNoteBanner(note: TFile): Promise<void> {
    const content = await this.app.vault.read(note);
    const imagePath = extractBannerImagePath(content);
    new ConfirmDeleteImageModal(this.app, Boolean(imagePath), async (deleteImage) => {
      const removed = await removeBannerBlock(this.app.vault, note);
      if (!removed) {
        new Notice("当前日记没有轨迹封面。");
        return;
      }
      if (deleteImage && imagePath) {
        const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
        if (imageFile instanceof TFile) {
          await this.app.vault.delete(imageFile);
        }
      }
      new Notice("当前日记的 GPX 轨迹封面已清除。");
    }).open();
  }
}

class ConfirmDeleteImageModal extends Modal {
  constructor(
    app: App,
    private hasImage: boolean,
    private onConfirm: (deleteImage: boolean) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "清除轨迹封面" });
    contentEl.createEl("p", { text: "只会删除当前日记中的轨迹封面标记，不会改动其他正文。" });
    const buttons = contentEl.createDiv({ cls: "gpx-daily-banner-confirm" });

    const cancel = buttons.createEl("button", { text: "取消" });
    cancel.onclick = () => this.close();

    if (this.hasImage) {
      const keepImage = buttons.createEl("button", { text: "保留图片" });
      keepImage.onclick = () => {
        this.close();
        void this.onConfirm(false);
      };
      const deleteImage = buttons.createEl("button", { text: "同时删除图片", cls: "mod-warning" });
      deleteImage.onclick = () => {
        this.close();
        void this.onConfirm(true);
      };
    } else {
      const confirm = buttons.createEl("button", { text: "清除", cls: "mod-cta" });
      confirm.onclick = () => {
        this.close();
        void this.onConfirm(false);
      };
    }
  }
}

function hideBannerMarkers(container: HTMLElement): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    if (!text.includes(BANNER_START) && !text.includes(BANNER_END)) continue;

    const nextText = text.split(BANNER_START).join("").split(BANNER_END).join("");
    if (nextText.trim()) {
      node.nodeValue = nextText;
      continue;
    }

    const parent = node.parentElement;
    node.remove();
    removeEmptyMarkerWrapper(parent);
  }
}

function removeEmptyMarkerWrapper(element: HTMLElement | null): void {
  if (!element) return;
  if (element.matches("p, div") && element.textContent?.trim() === "" && element.querySelectorAll("img, canvas, svg, video, audio, iframe").length === 0) {
    element.remove();
  }
}

function hideLivePreviewBannerMarkers(container: ParentNode): void {
  const lines = container.querySelectorAll<HTMLElement>(".markdown-source-view.mod-cm6.is-live-preview .cm-line");
  for (const line of Array.from(lines)) {
    const text = line.textContent?.trim();
    line.classList.toggle("gpx-daily-banner-marker-line", text === BANNER_START || text === BANNER_END);
  }
}
