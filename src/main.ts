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
import { BANNER_END, BANNER_START, cleanFilePath, cleanFolderPath, debug, delay, isGpxFile, isTFile, joinPath, replaceCssVariables } from "./utils";

export default class GpxDailyBannerPlugin extends Plugin {
  settings: GpxDailyBannerSettings = { ...DEFAULT_SETTINGS };
  data: PluginData = { records: {}, dailyDataRecords: {} };
  manager!: BannerManager;
  private dailyDataRefreshTimers = new Map<string, number>();

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
      const handleVaultFileCreate = (file: TAbstractFile) => {
        void this.handleVaultFileChange(file, "create");
      };
      const handleVaultFileModify = (file: TAbstractFile) => {
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

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
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
    if (legacyAmapStandardTileUrls.includes(loaded?.tileUrlTemplate) && (!loaded?.mapTilePreset || loaded.mapTilePreset === "amap-standard")) {
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
      decorateBannerEmbeds(element);
      hideBannerMarkers(element);
      scheduleBannerHeroAlignment();
    });

    const alignForViewportChange = () => {
      scheduleBannerHeroAlignment();
    };

    const observer = new MutationObserver((mutations) => {
      let bannerLayoutChanged = false;
      for (const mutation of mutations) {
        for (const addedNode of Array.from(mutation.addedNodes)) {
          const container = mutationContainer(addedNode);
          if (!container) continue;
          bannerLayoutChanged = decorateBannerEmbeds(container) || bannerLayoutChanged;
          hideLivePreviewBannerMarkers(container);
          bannerLayoutChanged = containerTouchesBannerHero(container) || bannerLayoutChanged;
        }
      }
      if (bannerLayoutChanged) scheduleBannerHeroAlignment();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.register(() => observer.disconnect());

    const viewportObserver = new ResizeObserver(alignForViewportChange);
    viewportObserver.observe(document.documentElement);
    this.register(() => viewportObserver.disconnect());

    const mobileLayout = window.matchMedia("(max-width: 600px)");
    mobileLayout.addEventListener("change", alignForViewportChange);
    this.register(() => mobileLayout.removeEventListener("change", alignForViewportChange));

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener("resize", alignForViewportChange);
      this.register(() => visualViewport.removeEventListener("resize", alignForViewportChange));
    }

    this.registerEvent(this.app.workspace.on("layout-change", alignForViewportChange));
    this.registerDomEvent(window, "resize", alignForViewportChange);

    decorateBannerEmbeds(document.body);
    hideLivePreviewBannerMarkers(document.body);
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

let bannerHeroAlignmentPending = false;
const BANNER_VIEW_SELECTOR = ".markdown-preview-view, .markdown-source-view.mod-cm6";
const BANNER_HERO_ENTRANCE_CLASS = "gpx-daily-banner-hero-enter";
const BANNER_EMBED_CONTAINER_SELECTOR = ".image-embed, .internal-embed, .cm-embed-block";
const bannerHeroEntranceState = new WeakMap<HTMLElement, { key: string; variants: Set<string> }>();

function scheduleBannerHeroAlignment(): void {
  if (bannerHeroAlignmentPending) return;
  bannerHeroAlignmentPending = true;
  window.requestAnimationFrame(() => {
    bannerHeroAlignmentPending = false;
    alignBannerHeroEmbeds();
  });
}

function alignBannerHeroEmbeds(): void {
  const heroes = document.querySelectorAll<HTMLElement>(".gpx-daily-banner-hero");
  for (const hero of Array.from(heroes)) {
    const view = hero.closest<HTMLElement>(".markdown-preview-view, .markdown-source-view.mod-cm6");
    if (!view) continue;

    const heroRect = hero.getBoundingClientRect();
    const viewRect = view.getBoundingClientRect();
    if (viewRect.width <= 0 || heroRect.width <= 0) continue;

    const scrollContainer = view.matches(".markdown-source-view.mod-cm6")
      ? view.querySelector<HTMLElement>(".cm-scroller")
      : view;
    const scrollTop = scrollContainer?.scrollTop ?? 0;
    const computed = window.getComputedStyle(hero);
    const appliedShiftX = Number.parseFloat(computed.marginLeft) || 0;
    const appliedShiftY = Number.parseFloat(computed.marginTop) || 0;
    const correctionX = viewRect.left - heroRect.left;
    const correctionY = viewRect.top - (heroRect.top + scrollTop);

    setStylePropertyIfChanged(hero, "--gpx-hero-shift-x", `${Math.round(appliedShiftX + correctionX)}px`);
    setStylePropertyIfChanged(hero, "--gpx-hero-shift-y", `${Math.round(appliedShiftY + correctionY)}px`);
    setStylePropertyIfChanged(hero, "--gpx-hero-width", `${Math.round(viewRect.width)}px`);
    setStylePropertyIfChanged(hero, "--gpx-hero-height", `${Math.round(viewRect.height)}px`);
  }
}

function setStylePropertyIfChanged(element: HTMLElement, property: string, value: string): void {
  if (element.style.getPropertyValue(property) === value) return;
  element.style.setProperty(property, value);
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

function decorateBannerEmbeds(container: ParentNode): boolean {
  const embeds = collectBannerEmbeds(container);
  let changed = false;
  for (const embed of embeds) {
    if (embed.parentElement?.closest(".gpx-daily-banner-hero") || embed.querySelector(".gpx-daily-banner-hero")) continue;
    changed = addClassIfMissing(embed, "gpx-daily-banner-hero") || changed;
    const marker = bannerEmbedMarker(embed);
    const isMobile = marker.includes("hero-mobile");
    const isDesktop = marker.includes("hero-desktop");
    changed = toggleClassIfNeeded(embed, "gpx-daily-banner-hero-mobile", isMobile) || changed;
    changed = toggleClassIfNeeded(embed, "gpx-daily-banner-hero-desktop", isDesktop) || changed;
    applyHeroEntranceOnce(embed, marker, isMobile ? "mobile" : isDesktop ? "desktop" : "default");
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
  const key = marker
    .replace(/-gpx-hero-(?:desktop|mobile)/gi, "-gpx-hero")
    .replace(/\bhero-(?:desktop|mobile)\b/gi, "hero");
  const previous = bannerHeroEntranceState.get(view);
  const state = previous?.key === key ? previous : { key, variants: new Set<string>() };
  if (!state.variants.has(variant)) {
    embed.classList.add(BANNER_HERO_ENTRANCE_CLASS);
    state.variants.add(variant);
  }
  bannerHeroEntranceState.set(view, state);
}

function mutationContainer(node: Node): ParentNode | null {
  if (node instanceof HTMLElement) return node;
  return node.parentElement;
}

function containerTouchesBannerHero(container: ParentNode): boolean {
  if (!(container instanceof HTMLElement)) return false;
  return container.classList.contains("gpx-daily-banner-hero")
    || Boolean(container.closest(".gpx-daily-banner-hero"))
    || Boolean(container.querySelector(".gpx-daily-banner-hero"));
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
    toggleClassIfNeeded(line, "gpx-daily-banner-marker-line", text === BANNER_START || text === BANNER_END);
  }
}
