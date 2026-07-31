import { App, Modal, Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { BannerManager } from "./banner-manager";
import { dailyDataRawFileName } from "./daily-data-date";
import { readCoreDailyNotesSettings, shouldFollowCoreDailyNotesSettings } from "./daily-notes-config";
import { extractBannerImagePaths, removeBannerBlock } from "./daily-note";
import { GPX_VIEW_TYPE, GpxPreviewView } from "./gpx-view";
import { inferMapTilePresetId } from "./map-presets";
import { DEFAULT_SETTINGS, GpxDailyBannerSettingTab } from "./settings";
import { todayKey } from "./track-date";
import { GpxDailyBannerSettings, PluginData } from "./types";
import { BANNER_END, BANNER_START, cleanFilePath, cleanFolderPath, debug, delay, isGpxFile, isTFile, joinPath } from "./utils";

type StoredPluginData = Partial<GpxDailyBannerSettings & PluginData>;

export default class GpxDailyBannerPlugin extends Plugin {
  settings: GpxDailyBannerSettings = { ...DEFAULT_SETTINGS };
  data: PluginData = { records: {}, dailyDataRecords: {} };
  manager!: BannerManager;
  private dailyDataRefreshTimers = new Map<string, number>();

  async onload(): Promise<void> {
    const loaded = await this.loadData() as StoredPluginData | null;
    this.loadSettings(loaded);
    this.loadPluginData(loaded);

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
      const handleVaultFileCreate = (file: TAbstractFile) => {
        void this.handleVaultFileChange(file, "create");
      };
      const handleVaultFileModify = (file: TAbstractFile) => {
        if (!isGpxFile(file) && !this.isTodayDailyDataBridgeFile(file)) return;
        void this.handleVaultFileChange(file, "modify");
      };
      this.registerEvent(this.app.vault.on("create", handleVaultFileCreate));
      this.registerEvent(this.app.vault.on("modify", handleVaultFileModify));

      const startupRefresh = window.setTimeout(() => {
        void this.refreshTodayDailyDataOnStartup();
      }, this.settings.dailyDataStartupDelaySeconds * 1000);
      this.register(() => window.clearTimeout(startupRefresh));
      this.register(() => this.clearDailyDataRefreshTimers());
    });

    debug(this.settings, "loaded");
  }

  onunload(): void {
    debug(this.settings, "unloaded");
  }

  loadSettings(loaded: StoredPluginData | null): void {
    const storedSettings = Object.fromEntries(
      (Object.keys(DEFAULT_SETTINGS) as Array<keyof GpxDailyBannerSettings>)
        .filter((key) => loaded?.[key] !== undefined)
        .map((key) => [key, loaded?.[key]])
    ) as Partial<GpxDailyBannerSettings>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings);
    const legacyDefaultTileUrl = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";
    const legacyDefaultAttribution = "© OpenStreetMap contributors © CARTO";
    if (loaded?.mapTilePreset === "carto-light" && loaded?.tileUrlTemplate === legacyDefaultTileUrl && loaded?.tileAttribution === legacyDefaultAttribution) {
      this.settings.mapTilePreset = DEFAULT_SETTINGS.mapTilePreset;
      this.settings.tileUrlTemplate = DEFAULT_SETTINGS.tileUrlTemplate;
      this.settings.tileAttribution = DEFAULT_SETTINGS.tileAttribution;
      this.settings.maxZoom = DEFAULT_SETTINGS.maxZoom;
    }
    const legacyAmapStandardTileUrls = [
      "https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&size=1&scl=1&style=8&ltype=11",
      "https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&x={x}&y={y}&z={z}&size=1&scl=1&style=8"
    ];
    if (loaded?.tileUrlTemplate && legacyAmapStandardTileUrls.includes(loaded.tileUrlTemplate) && (!loaded.mapTilePreset || loaded.mapTilePreset === "amap-standard")) {
      this.settings.mapTilePreset = DEFAULT_SETTINGS.mapTilePreset;
      this.settings.tileUrlTemplate = DEFAULT_SETTINGS.tileUrlTemplate;
      this.settings.tileAttribution = DEFAULT_SETTINGS.tileAttribution;
    }
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
    if (typeof this.settings.mapTileToken !== "string") {
      this.settings.mapTileToken = DEFAULT_SETTINGS.mapTileToken;
    }
    if (this.settings.trackCoordinateSystem !== "wgs84" && this.settings.trackCoordinateSystem !== "gcj02") {
      this.settings.trackCoordinateSystem = DEFAULT_SETTINGS.trackCoordinateSystem;
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

  loadPluginData(loaded: StoredPluginData | null): void {
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
    this.register(cancelBannerHeroAlignment);
    const mobileLayout = window.matchMedia("(max-width: 600px)");
    const observedBannerViews = new Set<HTMLElement>();
    const bannerViewResizeObserver = new ResizeObserver((entries) => {
      let activeBannerResized = false;
      for (const entry of entries) {
        const view = entry.target as HTMLElement;
        if (!view.classList.contains(BANNER_VIEW_CLASS)) {
          bannerViewResizeObserver.unobserve(view);
          observedBannerViews.delete(view);
          continue;
        }
        activeBannerResized = true;
      }
      if (activeBannerResized) scheduleBannerHeroAlignment();
    });
    const observeBannerViews = () => {
      for (const view of Array.from(this.app.workspace.containerEl.querySelectorAll<HTMLElement>(ACTIVE_BANNER_VIEW_SELECTOR))) {
        if (observedBannerViews.has(view)) continue;
        observedBannerViews.add(view);
        bannerViewResizeObserver.observe(view);
      }
    };
    this.register(() => {
      bannerViewResizeObserver.disconnect();
      observedBannerViews.clear();
    });

    this.registerMarkdownPostProcessor((element) => {
      if (decorateBannerEmbeds(element, mobileLayout.matches)) {
        alignBannerHeroEmbeds();
        scheduleBannerHeroAlignment();
      }
    });

    const alignForViewportChange = () => {
      updateHeroImagePriorities(this.app.workspace.containerEl, mobileLayout.matches);
      scheduleBannerHeroAlignment();
    };

    const observer = new MutationObserver((mutations) => {
      const mutationRoots = collectLivePreviewMutationRoots(mutations);
      const attachedHeroRoots = collectAttachedHeroRoots(mutations);
      const affectedViews = collectAffectedBannerViews(mutations, mutationRoots);
      let bannerLayoutChanged = false;
      for (const container of mutationRoots) {
        bannerLayoutChanged = decorateBannerEmbeds(container, mobileLayout.matches) || bannerLayoutChanged;
        hideLivePreviewBannerMarkers(container);
        bannerLayoutChanged = containerTouchesBannerHero(container) || bannerLayoutChanged;
      }
      for (const container of attachedHeroRoots) {
        bannerLayoutChanged = finalizeAttachedBannerHeroes(container, mobileLayout.matches) || bannerLayoutChanged;
      }
      for (const view of affectedViews) {
        bannerLayoutChanged = syncBannerViewState(view) || bannerLayoutChanged;
      }
      if (bannerLayoutChanged) {
        observeBannerViews();
        // Finish the first full-screen layout before the browser paints. The
        // queued frame below is only a follow-up for theme or viewport changes.
        alignBannerHeroEmbeds();
        scheduleBannerHeroAlignment();
      }
    });
    observer.observe(this.app.workspace.containerEl, { childList: true, characterData: true, subtree: true });
    this.register(() => observer.disconnect());

    mobileLayout.addEventListener("change", alignForViewportChange);
    this.register(() => mobileLayout.removeEventListener("change", alignForViewportChange));

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener("resize", alignForViewportChange);
      this.register(() => visualViewport.removeEventListener("resize", alignForViewportChange));
    }

    this.registerEvent(this.app.workspace.on("layout-change", alignForViewportChange));
    this.registerDomEvent(window, "resize", alignForViewportChange);

    for (const view of Array.from(this.app.workspace.containerEl.querySelectorAll<HTMLElement>(BANNER_VIEW_SELECTOR))) {
      decorateBannerEmbeds(view, mobileLayout.matches);
      hideLivePreviewBannerMarkers(view);
      syncBannerViewState(view);
    }
    observeBannerViews();
    alignBannerHeroEmbeds();
    scheduleBannerHeroAlignment();
  }

  private async handleVaultFileChange(file: TAbstractFile, eventType: "create" | "modify"): Promise<void> {
    if (isGpxFile(file)) {
      await this.manager.processGpxFile(file);
      return;
    }
    if (file instanceof TFile && file.extension === "md") {
      // A pending track only needs the note's creation event. Listening to every
      // Markdown modification means each keystroke/save performs needless work.
      if (eventType === "create") {
        await this.manager.retryPendingForNote(file.path);
      }
      return;
    }
    if (this.isTodayDailyDataBridgeFile(file)) {
      this.scheduleDailyDataRefresh(todayKey(this.settings));
    }
  }

  private async refreshTodayDailyDataOnStartup(): Promise<void> {
    const retryDelays = [0, 1500, 3000, 5000];
    for (const retryDelay of retryDelays) {
      if (retryDelay > 0) await delay(retryDelay);
      try {
        const sourceReady = await this.manager.refreshTodayDailyData();
        if (sourceReady) return;
      } catch (error) {
        debug(this.settings, "startup daily data refresh failed", error);
      }
    }
    debug(this.settings, "startup daily data refresh exhausted");
  }

  private isTodayDailyDataBridgeFile(file: TAbstractFile): boolean {
    if (!(file instanceof TFile) || this.settings.dailyDataSourceMode !== "bridge") return false;
    const dateKey = todayKey(this.settings);
    const rawName = dailyDataRawFileName(dateKey, this.settings);
    const folder = cleanFolderPath(this.settings.dailyDataBridgeFolder);
    if (!folder) return false;
    const filePath = cleanFilePath(file.path);
    return filePath === joinPath(folder, rawName) || filePath === joinPath(folder, `${rawName}.csv`);
  }

  private scheduleDailyDataRefresh(dateKey: string): void {
    const previous = this.dailyDataRefreshTimers.get(dateKey);
    if (previous !== undefined) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      this.dailyDataRefreshTimers.delete(dateKey);
      void this.manager.refreshDailyDataForDate(dateKey).catch((error) => {
        debug(this.settings, "daily data change refresh failed", dateKey, error);
      });
    }, 1200);
    this.dailyDataRefreshTimers.set(dateKey, timer);
  }

  private clearDailyDataRefreshTimers(): void {
    for (const timer of this.dailyDataRefreshTimers.values()) window.clearTimeout(timer);
    this.dailyDataRefreshTimers.clear();
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
    const imagePaths = extractBannerImagePaths(content);
    new ConfirmDeleteImageModal(this.app, imagePaths.length > 0, async (deleteImage) => {
      const removed = await removeBannerBlock(this.app.vault, note);
      if (!removed) {
        new Notice("当前日记没有轨迹封面。");
        return;
      }
      if (deleteImage) {
        for (const imagePath of imagePaths) {
          const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
          if (imageFile instanceof TFile) {
            await this.app.vault.delete(imageFile);
          }
        }
      }
      new Notice("当前日记的 GPX 轨迹封面已清除。");
    }).open();
  }
}

let bannerHeroAlignmentFrame: number | null = null;
const BANNER_VIEW_SELECTOR = ".markdown-preview-view, .markdown-source-view.mod-cm6";
const ACTIVE_BANNER_VIEW_SELECTOR = ".markdown-preview-view.gpx-daily-banner-view, .markdown-source-view.mod-cm6.gpx-daily-banner-view";
const LIVE_PREVIEW_VIEW_SELECTOR = ".markdown-source-view.mod-cm6";
const BANNER_VIEW_CLASS = "gpx-daily-banner-view";
const BANNER_CONTAINER_CLASS = "gpx-daily-banner-hero-container";
const BANNER_HERO_ENTRANCE_CLASS = "gpx-daily-banner-hero-enter";
const BANNER_EMBED_CONTAINER_SELECTOR = ".image-embed, .internal-embed, .cm-embed-block";
const bannerHeroEntranceState = new WeakMap<HTMLElement, { key: string; variants: Set<string> }>();

function scheduleBannerHeroAlignment(): void {
  if (bannerHeroAlignmentFrame !== null) return;
  bannerHeroAlignmentFrame = window.requestAnimationFrame(() => {
    bannerHeroAlignmentFrame = null;
    alignBannerHeroEmbeds();
  });
}

function cancelBannerHeroAlignment(): void {
  if (bannerHeroAlignmentFrame === null) return;
  window.cancelAnimationFrame(bannerHeroAlignmentFrame);
  bannerHeroAlignmentFrame = null;
}

function alignBannerHeroEmbeds(): void {
  const views = document.querySelectorAll<HTMLElement>(ACTIVE_BANNER_VIEW_SELECTOR);
  for (const view of Array.from(views)) {
    const viewRect = view.getBoundingClientRect();
    const viewWidth = view.clientWidth;
    const viewHeight = view.clientHeight;
    if (viewRect.width <= 0 || viewRect.height <= 0 || viewWidth <= 0 || viewHeight <= 0) continue;
    const scaleX = viewRect.width / viewWidth;
    const scaleY = viewRect.height / viewHeight;
    if (scaleX <= 0 || scaleY <= 0) continue;

    const scrollContainer = view.matches(".markdown-source-view.mod-cm6")
      ? view.querySelector<HTMLElement>(".cm-scroller")
      : view;
    const scrollTop = scrollContainer?.scrollTop ?? 0;
    const heroes = view.querySelectorAll<HTMLElement>(".gpx-daily-banner-hero");
    for (const hero of Array.from(heroes)) {
      const heroRect = hero.getBoundingClientRect();
      if (heroRect.width <= 0) continue;

      const appliedShiftX = Number.parseFloat(hero.style.getPropertyValue("margin-left")) || 0;
      const appliedShiftY = Number.parseFloat(hero.style.getPropertyValue("margin-top")) || 0;
      const correctionX = (viewRect.left - heroRect.left) / scaleX;
      const correctionY = (viewRect.top - (heroRect.top + scrollTop * scaleY)) / scaleY;

      setStylePropertyIfChanged(hero, "margin-left", `${Math.round(appliedShiftX + correctionX)}px`, "important");
      setStylePropertyIfChanged(hero, "margin-top", `${Math.round(appliedShiftY + correctionY)}px`, "important");
      setStylePropertyIfChanged(hero, "width", `${viewWidth}px`, "important");
      setStylePropertyIfChanged(hero, "height", `${viewHeight}px`, "important");
      setStylePropertyIfChanged(hero, "min-height", `${viewHeight}px`, "important");
    }
  }
}

function setStylePropertyIfChanged(element: HTMLElement, property: string, value: string, priority = ""): void {
  if (element.style.getPropertyValue(property) === value && element.style.getPropertyPriority(property) === priority) return;
  element.style.setProperty(property, value, priority);
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

function decorateBannerEmbeds(container: ParentNode, mobileLayout: boolean): boolean {
  const embeds = collectBannerEmbeds(container);
  const touchedViews = new Set<HTMLElement>();
  let changed = false;
  for (const embed of embeds) {
    if (embed.parentElement?.closest(".gpx-daily-banner-hero") || embed.querySelector(".gpx-daily-banner-hero")) continue;
    changed = removeLegacyHeroStyles(embed) || changed;
    changed = addClassIfMissing(embed, "gpx-daily-banner-hero") || changed;
    const marker = bannerEmbedMarker(embed);
    const isMobile = marker.includes("hero-mobile");
    const isDesktop = marker.includes("hero-desktop");
    changed = toggleClassIfNeeded(embed, "gpx-daily-banner-hero-mobile", isMobile) || changed;
    changed = toggleClassIfNeeded(embed, "gpx-daily-banner-hero-desktop", isDesktop) || changed;
    const view = embed.closest<HTMLElement>(BANNER_VIEW_SELECTOR);
    if (view) {
      touchedViews.add(view);
      changed = markHeroContainers(embed, view) || changed;
    }
    configureHeroImage(embed, isMobile, isDesktop, mobileLayout);
    applyHeroEntranceOnce(embed, marker, isMobile ? "mobile" : isDesktop ? "desktop" : "default");
  }
  for (const view of touchedViews) {
    changed = syncBannerViewState(view) || changed;
  }
  return changed;
}

function removeLegacyHeroStyles(embed: HTMLElement): boolean {
  let changed = false;
  for (const property of ["--gpx-hero-shift-x", "--gpx-hero-shift-y", "--gpx-hero-width", "--gpx-hero-height"]) {
    if (!embed.style.getPropertyValue(property)) continue;
    embed.style.removeProperty(property);
    changed = true;
  }
  return changed;
}

function finalizeAttachedBannerHeroes(container: ParentNode, mobileLayout: boolean): boolean {
  const heroes = new Set<HTMLElement>();
  if (container instanceof HTMLElement) {
    if (container.classList.contains("gpx-daily-banner-hero")) heroes.add(container);
    const closestHero = container.closest<HTMLElement>(".gpx-daily-banner-hero");
    if (closestHero) heroes.add(closestHero);
  }
  for (const hero of Array.from(container.querySelectorAll<HTMLElement>(".gpx-daily-banner-hero"))) {
    heroes.add(hero);
  }

  const touchedViews = new Set<HTMLElement>();
  let changed = false;
  for (const hero of heroes) {
    const view = hero.closest<HTMLElement>(BANNER_VIEW_SELECTOR);
    if (!view) continue;
    touchedViews.add(view);
    changed = markHeroContainers(hero, view) || changed;
    const marker = bannerEmbedMarker(hero);
    const isMobile = hero.classList.contains("gpx-daily-banner-hero-mobile");
    const isDesktop = hero.classList.contains("gpx-daily-banner-hero-desktop");
    configureHeroImage(hero, isMobile, isDesktop, mobileLayout);
    applyHeroEntranceOnce(hero, marker, isMobile ? "mobile" : isDesktop ? "desktop" : "default");
  }
  for (const view of touchedViews) {
    changed = syncBannerViewState(view) || changed;
  }
  return changed;
}

function collectBannerEmbeds(container: ParentNode): HTMLElement[] {
  const candidates = new Set<HTMLElement>();
  if (container instanceof HTMLElement) {
    if (container.matches(BANNER_EMBED_CONTAINER_SELECTOR)) candidates.add(container);
    const ancestors: HTMLElement[] = [];
    let closest = container.closest<HTMLElement>(BANNER_EMBED_CONTAINER_SELECTOR);
    while (closest) {
      ancestors.push(closest);
      closest = closest.parentElement?.closest<HTMLElement>(BANNER_EMBED_CONTAINER_SELECTOR) ?? null;
    }
    for (const ancestor of ancestors.reverse()) candidates.add(ancestor);
  }
  for (const candidate of Array.from(container.querySelectorAll<HTMLElement>(BANNER_EMBED_CONTAINER_SELECTOR))) {
    candidates.add(candidate);
  }
  return Array.from(candidates).filter(isBannerEmbed);
}

function isBannerEmbed(embed: HTMLElement): boolean {
  const marker = bannerEmbedMarker(embed).toLowerCase();
  return marker.includes("gpx-daily-banner")
    || marker.includes("-gpx-banner")
    || marker.includes("-gpx-hero-");
}

function bannerEmbedMarker(embed: HTMLElement): string {
  const image = embed.querySelector("img");
  const alt = embed.getAttribute("alt") ?? image?.getAttribute("alt") ?? "";
  const source = embed.getAttribute("src") ?? image?.getAttribute("src") ?? "";
  return `${alt} ${source}`;
}

function markHeroContainers(embed: HTMLElement, view: HTMLElement): boolean {
  const contentRoot = view.matches(".markdown-preview-view")
    ? view.querySelector<HTMLElement>(".markdown-preview-section")
    : view.querySelector<HTMLElement>(".cm-content");
  if (!contentRoot) return false;

  let changed = false;
  let current = embed.parentElement;
  while (current && current !== contentRoot) {
    changed = addClassIfMissing(current, BANNER_CONTAINER_CLASS) || changed;
    current = current.parentElement;
  }
  return changed;
}

function syncBannerViewState(view: HTMLElement): boolean {
  const hasHero = Boolean(view.querySelector(".gpx-daily-banner-hero"));
  let changed = toggleClassIfNeeded(view, BANNER_VIEW_CLASS, hasHero);
  for (const container of Array.from(view.querySelectorAll<HTMLElement>(`.${BANNER_CONTAINER_CLASS}`))) {
    if (!container.querySelector(".gpx-daily-banner-hero")) {
      container.classList.remove(BANNER_CONTAINER_CLASS);
      changed = true;
    }
  }
  return changed;
}

function configureHeroImage(embed: HTMLElement, isMobile: boolean, isDesktop: boolean, mobileLayout: boolean): void {
  const image = embed.querySelector<HTMLImageElement>("img");
  if (!image) return;
  image.decoding = "async";
  const activeVariant = !isMobile && !isDesktop
    ? true
    : mobileLayout
      ? isMobile
      : isDesktop;
  image.loading = activeVariant ? "eager" : "lazy";
  image.setAttribute("fetchpriority", activeVariant ? "high" : "low");
}

function updateHeroImagePriorities(container: ParentNode, mobileLayout: boolean): void {
  for (const hero of Array.from(container.querySelectorAll<HTMLElement>(".gpx-daily-banner-hero"))) {
    configureHeroImage(
      hero,
      hero.classList.contains("gpx-daily-banner-hero-mobile"),
      hero.classList.contains("gpx-daily-banner-hero-desktop"),
      mobileLayout
    );
  }
}

function addClassIfMissing(element: HTMLElement, className: string): boolean {
  if (element.classList.contains(className)) return false;
  element.classList.add(className);
  return true;
}

function toggleClassIfNeeded(element: HTMLElement, className: string, enabled: boolean): boolean {
  if (element.classList.contains(className) === enabled) return false;
  element.classList.toggle(className, enabled);
  return true;
}

function applyHeroEntranceOnce(embed: HTMLElement, marker: string, variant: string): void {
  const view = embed.closest<HTMLElement>(BANNER_VIEW_SELECTOR);
  if (!view) return;
  const owner = embed.closest<HTMLElement>(".workspace-leaf") ?? view;
  const key = marker
    .replace(/-gpx-hero-(?:desktop|mobile)/gi, "-gpx-hero")
    .replace(/\bhero-(?:desktop|mobile)\b/gi, "hero");
  const previous = bannerHeroEntranceState.get(owner);
  const state = previous?.key === key ? previous : { key, variants: new Set<string>() };
  if (!state.variants.has(variant)) {
    embed.classList.add(BANNER_HERO_ENTRANCE_CLASS);
    state.variants.add(variant);
  }
  bannerHeroEntranceState.set(owner, state);
}

function mutationElement(node: Node): HTMLElement | null {
  if (node instanceof HTMLElement) return node;
  return node.parentElement;
}

function collectLivePreviewMutationRoots(mutations: MutationRecord[]): HTMLElement[] {
  const roots = new Set<HTMLElement>();
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      const element = mutationElement(mutation.target);
      if (element?.closest(LIVE_PREVIEW_VIEW_SELECTOR) && elementMayContainBanner(element)) {
        addMinimalMutationRoot(roots, element);
      }
    }
    for (const addedNode of Array.from(mutation.addedNodes)) {
      const element = mutationElement(addedNode);
      if (!element) continue;
      const containingView = element.closest<HTMLElement>(LIVE_PREVIEW_VIEW_SELECTOR);
      if (containingView) {
        if (elementMayContainBanner(element)) {
          addMinimalMutationRoot(roots, element);
        }
        continue;
      }
      for (const view of Array.from(element.querySelectorAll<HTMLElement>(LIVE_PREVIEW_VIEW_SELECTOR))) {
        if (elementMayContainBanner(view)) {
          addMinimalMutationRoot(roots, view);
        }
      }
    }
  }
  return Array.from(roots);
}

function collectAttachedHeroRoots(mutations: MutationRecord[]): HTMLElement[] {
  const roots = new Set<HTMLElement>();
  for (const mutation of mutations) {
    for (const addedNode of Array.from(mutation.addedNodes)) {
      const element = mutationElement(addedNode);
      if (!element) continue;
      if (!element.classList.contains("gpx-daily-banner-hero") && !element.querySelector(".gpx-daily-banner-hero")) continue;
      addMinimalMutationRoot(roots, element);
    }
  }
  return Array.from(roots);
}

function elementMayContainBanner(element: HTMLElement): boolean {
  if (element.matches(BANNER_EMBED_CONTAINER_SELECTOR) || element.classList.contains("gpx-daily-banner-marker-line")) {
    return true;
  }
  if (element.closest(BANNER_EMBED_CONTAINER_SELECTOR) || element.querySelector(BANNER_EMBED_CONTAINER_SELECTOR)) {
    return true;
  }
  return element.textContent?.includes("gpx-daily-banner:") === true;
}

function addMinimalMutationRoot(roots: Set<HTMLElement>, candidate: HTMLElement): void {
  for (const existing of Array.from(roots)) {
    if (existing.contains(candidate)) return;
    if (candidate.contains(existing)) roots.delete(existing);
  }
  roots.add(candidate);
}

function collectAffectedBannerViews(mutations: MutationRecord[], roots: HTMLElement[]): Set<HTMLElement> {
  const views = new Set<HTMLElement>();
  for (const root of roots) {
    const view = root.closest<HTMLElement>(LIVE_PREVIEW_VIEW_SELECTOR);
    if (view) views.add(view);
  }
  for (const mutation of mutations) {
    if (!Array.from(mutation.removedNodes).some(nodeTouchesDecoratedBanner)) continue;
    const target = mutationElement(mutation.target);
    const view = target?.closest<HTMLElement>(BANNER_VIEW_SELECTOR);
    if (view) views.add(view);
  }
  return views;
}

function nodeTouchesDecoratedBanner(node: Node): boolean {
  if (node instanceof Text) {
    return node.data.includes("gpx-daily-banner:");
  }
  if (!(node instanceof HTMLElement)) return false;
  return node.classList.contains("gpx-daily-banner-hero")
    || node.classList.contains("gpx-daily-banner-marker-line")
    || Boolean(node.querySelector(".gpx-daily-banner-hero, .gpx-daily-banner-marker-line"));
}

function containerTouchesBannerHero(container: ParentNode): boolean {
  if (!(container instanceof HTMLElement)) return false;
  return container.classList.contains("gpx-daily-banner-hero")
    || Boolean(container.closest(".gpx-daily-banner-hero"))
    || Boolean(container.querySelector(".gpx-daily-banner-hero"));
}

function hideLivePreviewBannerMarkers(container: ParentNode): void {
  const lineSelector = ".markdown-source-view.mod-cm6.is-live-preview .cm-line";
  const lines = new Set<HTMLElement>();
  if (container instanceof HTMLElement) {
    if (container.matches(lineSelector)) lines.add(container);
    const closestLine = container.closest<HTMLElement>(".cm-line");
    if (closestLine?.closest(".markdown-source-view.mod-cm6.is-live-preview")) {
      lines.add(closestLine);
    }
  }
  for (const line of Array.from(container.querySelectorAll<HTMLElement>(lineSelector))) {
    lines.add(line);
  }
  for (const line of lines) {
    const text = line.textContent?.trim();
    if (!line.classList.contains("gpx-daily-banner-marker-line") && !text?.includes("gpx-daily-banner:")) continue;
    toggleClassIfNeeded(line, "gpx-daily-banner-marker-line", text === BANNER_START || text === BANNER_END);
  }
}
