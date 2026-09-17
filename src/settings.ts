import { App, Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type GpxDailyBannerPlugin from "./main";
import { AMAP_CLEAN_TILE_URL, DEFAULT_MAP_TILE_PRESET_ID, getMapTilePreset, MAP_TILE_PRESETS } from "./map-presets";
import { GpxDailyBannerSettings, MapCoordinateSystem, MapTilePresetId, SameDayMode, TimezoneMode } from "./types";
import { cleanFolderPath, joinPath } from "./utils";
import { DEFAULT_DAILY_DATA_GAP_MINUTES } from "./daily-data-parser";
import { dailyDataRawFileName } from "./daily-data-date";
import { readDailyDataForDate } from "./daily-data-source";
import { dailyNotePathForDate } from "./daily-note";
import { todayKey } from "./track-date";

export const DEFAULT_SETTINGS: GpxDailyBannerSettings = {
  inboxFolder: "GPX Inbox",
  lifeFootprintFolder: "一生足迹/DailyData",
  dailyDataBridgeFolder: "附件/当日轨迹",
  dailyDataSourceMode: "bridge",
  dailyDataGapMinutes: DEFAULT_DAILY_DATA_GAP_MINUTES,
  dailyDataStartupDelaySeconds: 1,
  dailyNoteFolder: "Daily Notes",
  dailyNoteDateFormat: "YYYY-MM-DD",
  dailyNoteExtension: "md",
  useCoreDailyNotesSettings: true,
  autoCreateDailyNote: false,
  bannerFolder: "Attachments/GPX Banners",
  imageWidth: 1600,
  imageHeight: 600,
  mapTilePreset: DEFAULT_MAP_TILE_PRESET_ID,
  tileUrlTemplate: AMAP_CLEAN_TILE_URL,
  tileAttribution: "© 高德地图",
  mapTileToken: "",
  trackCoordinateSystem: "wgs84",
  maxZoom: 18,
  maxTileCount: 64,
  trackColor: "#ef4444",
  trackColors: ["#ef4444", "#2563eb", "#16a34a", "#9333ea", "#ea580c"],
  trackLineWidth: 5,
  showStartMarker: true,
  showEndMarker: true,
  showDate: true,
  showDistance: true,
  showDuration: true,
  timezoneMode: "local",
  customTimezoneOffsetMinutes: 480,
  sameDayMode: "replace",
  onlineMapEnabled: true,
  offlineFallback: true,
  archiveAfterSuccess: false,
  autoDeleteAfterSuccess: false,
  archiveFolder: "GPX Archive",
  debugLogging: false
};

export class GpxDailyBannerSettingTab extends PluginSettingTab {
  plugin: GpxDailyBannerPlugin;

  constructor(app: App, plugin: GpxDailyBannerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.plugin.syncDailyNotesSettingsFromCore();

    // 1. 标题区
    new Setting(containerEl).setName("GPX Daily Banner").setHeading();
    containerEl.createEl("p", {
      cls: "gpx-daily-banner-settings-intro",
      text: "将“一生足迹”或手动上传的 GPX 轨迹自动渲染为精美日记地图封面。"
    });

    // 2. 状态看板
    this.renderStatusBar(containerEl);

    // 3. 同步与日记设置
    const syncSection = createSection(containerEl, "同步与日记", "配置文件同步路径以及与 Obsidian 日记的对应关联。");

    textSetting(
      syncSection,
      "轨迹同步文件夹",
      "一生足迹快捷指令保存 _raw 轨迹文件的目录。",
      this.plugin.settings.dailyDataBridgeFolder,
      async (value) => {
        this.plugin.settings.dailyDataBridgeFolder = cleanFolderPath(value) || DEFAULT_SETTINGS.dailyDataBridgeFolder;
        await this.plugin.saveSettings();
      }
    );

    // 日记配置跟随核心
    const coreSetting = new Setting(syncSection)
      .setName("跟随核心日记插件")
      .setDesc(
        this.plugin.settings.useCoreDailyNotesSettings
          ? `已自动跟随：文件夹「${this.plugin.settings.dailyNoteFolder || "根目录"}」，日期格式「${this.plugin.settings.dailyNoteDateFormat}」`
          : "开启后自动读取 Obsidian 核心 Daily Notes 的文件夹与日期格式设置。"
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useCoreDailyNotesSettings).onChange(async (value) => {
          this.plugin.settings.useCoreDailyNotesSettings = value;
          if (value && !this.plugin.syncDailyNotesSettingsFromCore()) {
            new Notice("没有读取到核心 Daily Notes 设置，请确认该核心插件已启用。");
          }
          await this.plugin.saveSettings();
          this.display();
        })
      );

    // 仅在关闭跟随核心设置时才展开手动输入项
    if (!this.plugin.settings.useCoreDailyNotesSettings) {
      textSetting(
        syncSection,
        "日记文件夹",
        "例如 Daily Notes；留空表示 Vault 根目录。",
        this.plugin.settings.dailyNoteFolder,
        async (value) => {
          this.plugin.settings.dailyNoteFolder = cleanFolderPath(value);
          await this.plugin.saveSettings();
        }
      );

      textSetting(
        syncSection,
        "日记日期格式",
        "格式如 YYYY-MM-DD，支持 / 子文件夹划分。",
        this.plugin.settings.dailyNoteDateFormat,
        async (value) => {
          this.plugin.settings.dailyNoteDateFormat = normalizePath(value.trim() || DEFAULT_SETTINGS.dailyNoteDateFormat);
          await this.plugin.saveSettings();
        }
      );
    }

    toggleSetting(
      syncSection,
      "日记不存在时自动创建",
      this.plugin.settings.autoCreateDailyNote,
      async (value) => {
        this.plugin.settings.autoCreateDailyNote = value;
        await this.plugin.saveSettings();
      },
      "开启后若当天日记尚不存在会自动生成文件并插入封面；关闭则等待日记创建。"
    );

    // 温馨提示卡片
    const tipsBox = syncSection.createDiv({ cls: "gpx-daily-banner-tips-card" });
    tipsBox.createEl("span", {
      text: "💡 提示：将任意日期的 .gpx 轨迹文件拖入或导入 Vault，插件将自动识别其日期并直接覆盖当天日记封面。"
    });

    // 4. 地图与封面外观
    const mapSection = createSection(containerEl, "地图与外观", "定制地图样式、轨迹颜色与封面叠加信息。");

    toggleSetting(
      mapSection,
      "使用在线地图底图",
      this.plugin.settings.onlineMapEnabled,
      async (value) => {
        this.plugin.settings.onlineMapEnabled = value;
        await this.plugin.saveSettings();
        this.display();
      },
      "关闭后将仅生成纯色离线轨迹图，不加载在线地图瓦片。"
    );

    if (this.plugin.settings.onlineMapEnabled) {
      new Setting(mapSection)
        .setName("地图背景样式")
        .setDesc("选择地图底图预设。国内首推高德清爽标注底图。")
        .addDropdown((dropdown) => {
          for (const preset of MAP_TILE_PRESETS) dropdown.addOption(preset.id, preset.name);
          dropdown.addOption("custom", "自定义瓦片源");
          dropdown.setValue(this.plugin.settings.mapTilePreset ?? "custom");
          dropdown.onChange(async (value) => {
            const presetId = value as MapTilePresetId;
            this.plugin.settings.mapTilePreset = presetId;
            const preset = getMapTilePreset(presetId);
            if (preset) {
              this.plugin.settings.tileUrlTemplate = preset.tileUrlTemplate;
              this.plugin.settings.tileAttribution = preset.tileAttribution;
              this.plugin.settings.maxZoom = preset.maxZoom;
            }
            await this.plugin.saveSettings();
            this.display();
            void this.plugin.regenerateAllBanners("地图背景已更新，正在重新生成轨迹封面。");
          });
        });
    }

    // 轨迹颜色（Color Picker + 快捷色块）
    const colorSetting = new Setting(mapSection)
      .setName("轨迹线颜色")
      .setDesc("点击色盘自选，或直接点选下方常用颜色。");

    colorSetting.addColorPicker((picker) =>
      picker.setValue(this.plugin.settings.trackColor).onChange(async (value) => {
        this.plugin.settings.trackColor = value;
        await this.plugin.saveSettings();
      })
    );

    const quickColorsContainer = mapSection.createDiv({ cls: "gpx-daily-banner-quick-colors" });
    for (const color of this.plugin.settings.trackColors) {
      const dot = quickColorsContainer.createDiv({
        cls: `gpx-daily-banner-color-dot${this.plugin.settings.trackColor.toLowerCase() === color.toLowerCase() ? " is-active" : ""}`
      });
      dot.style.backgroundColor = color;
      dot.title = color;
      dot.onclick = async () => {
        this.plugin.settings.trackColor = color;
        await this.plugin.saveSettings();
        this.display();
      };
    }

    numberSettingWithDesc(
      mapSection,
      "轨迹线宽度",
      "轨迹线条像素宽度，推荐 4~6 像素。",
      this.plugin.settings.trackLineWidth,
      1,
      20,
      async (value) => {
        this.plugin.settings.trackLineWidth = value;
        await this.plugin.saveSettings();
      }
    );

    // 封面信息展示开关（整合区域）
    const badgeSection = mapSection.createDiv({ cls: "gpx-daily-banner-badge-group" });
    badgeSection.createEl("h4", { text: "封面角标信息显示" });

    toggleSetting(badgeSection, "显示起点标记", this.plugin.settings.showStartMarker, async (v) => {
      this.plugin.settings.showStartMarker = v;
      await this.plugin.saveSettings();
    });

    toggleSetting(badgeSection, "显示终点标记", this.plugin.settings.showEndMarker, async (v) => {
      this.plugin.settings.showEndMarker = v;
      await this.plugin.saveSettings();
    });

    toggleSetting(badgeSection, "显示日期标签", this.plugin.settings.showDate, async (v) => {
      this.plugin.settings.showDate = v;
      await this.plugin.saveSettings();
    });

    toggleSetting(badgeSection, "显示总里程距离", this.plugin.settings.showDistance, async (v) => {
      this.plugin.settings.showDistance = v;
      await this.plugin.saveSettings();
    });

    toggleSetting(badgeSection, "显示运动耗时", this.plugin.settings.showDuration, async (v) => {
      this.plugin.settings.showDuration = v;
      await this.plugin.saveSettings();
    });

    new Setting(mapSection)
      .setName("重新生成所有历史封面")
      .setDesc("调整了地图源、颜色或标注后，点击将已有日记封面统一重新渲染。")
      .addButton((btn) =>
        btn
          .setButtonText("立即重新生成")
          .setCta()
          .onClick(() => {
            void this.plugin.regenerateAllBanners("正在重新生成已有轨迹封面。");
          })
      );

    // 5. 高级设置（折叠收纳）
    const advanced = containerEl.createEl("details", { cls: "gpx-daily-banner-settings-advanced" });
    advanced.createEl("summary", { text: "高级与开发者设置" });
    const advancedContent = advanced.createDiv({ cls: "gpx-daily-banner-settings-advanced-content" });

    // 仅在自定义地图源时展示瓦片配置
    if (this.plugin.settings.onlineMapEnabled && this.plugin.settings.mapTilePreset === "custom") {
      const customMap = createSubsection(advancedContent, "自定义地图瓦片配置");
      textSetting(customMap, "瓦片 URL 模板", "支持 {z}/{x}/{y} 及国内 {s}、{reverseY} 等。", this.plugin.settings.tileUrlTemplate, async (v) => {
        this.plugin.settings.tileUrlTemplate = v.trim();
        await this.plugin.saveSettings();
      });
      textSetting(customMap, "地图版权信息", "封面右下角显示的版权文字。", this.plugin.settings.tileAttribution, async (v) => {
        this.plugin.settings.tileAttribution = v.trim();
        await this.plugin.saveSettings();
      });
      numberSetting(customMap, "最大缩放级别 (Zoom)", this.plugin.settings.maxZoom, 1, 20, async (v) => {
        this.plugin.settings.maxZoom = v;
        await this.plugin.saveSettings();
      });
      numberSetting(customMap, "最大加载瓦片数", this.plugin.settings.maxTileCount, 4, 64, async (v) => {
        this.plugin.settings.maxTileCount = v;
        await this.plugin.saveSettings();
      });
      textSetting(customMap, "天地图 Token（可选）", "使用天地图时填写的开发令牌。", this.plugin.settings.mapTileToken, async (v) => {
        this.plugin.settings.mapTileToken = v.trim();
        await this.plugin.saveSettings();
      });
    }

    const trackOpts = createSubsection(advancedContent, "轨迹与时间算法");
    new Setting(trackOpts)
      .setName("轨迹坐标系")
      .setDesc("手机 GPS 通常为 WGS84。使用高德或腾讯底图时插件会自动进行中国境内纠偏。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("wgs84", "WGS84（标准 GPS，推荐）")
          .addOption("gcj02", "GCJ-02（已纠偏数据）")
          .setValue(this.plugin.settings.trackCoordinateSystem)
          .onChange(async (v) => {
            this.plugin.settings.trackCoordinateSystem = v as MapCoordinateSystem;
            await this.plugin.saveSettings();
          })
      );

    numberSettingWithDesc(trackOpts, "长距离断档分段阈值（分钟）", "超过此间隔不连线，防止产生横穿地图的直线。", this.plugin.settings.dailyDataGapMinutes, 1, 1440, async (v) => {
      this.plugin.settings.dailyDataGapMinutes = v;
      await this.plugin.saveSettings();
    });

    toggleSetting(trackOpts, "在线底图失败时生成离线轨迹", this.plugin.settings.offlineFallback, async (v) => {
      this.plugin.settings.offlineFallback = v;
      await this.plugin.saveSettings();
    });

    const gpxOpts = createSubsection(advancedContent, "GPX 文件管理");
    new Setting(gpxOpts)
      .setName("同一天多个 GPX 处理方式")
      .setDesc("默认覆盖模式：新上传的文件直接覆盖当天封面。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("replace", "覆盖模式（推荐）")
          .addOption("merge", "合并模式")
          .setValue(this.plugin.settings.sameDayMode)
          .onChange(async (v) => {
            this.plugin.settings.sameDayMode = v as SameDayMode;
            await this.plugin.saveSettings();
          })
      );

    toggleSetting(gpxOpts, "处理成功后自动删除 GPX", this.plugin.settings.autoDeleteAfterSuccess, async (v) => {
      this.plugin.settings.autoDeleteAfterSuccess = v;
      await this.plugin.saveSettings();
    }, "仅影响手动 GPX 文件，一生足迹文件不会被删除。");

    toggleSetting(gpxOpts, "处理成功后归档 GPX", this.plugin.settings.archiveAfterSuccess, async (v) => {
      this.plugin.settings.archiveAfterSuccess = v;
      await this.plugin.saveSettings();
      this.display();
    });

    if (this.plugin.settings.archiveAfterSuccess) {
      textSetting(gpxOpts, "GPX 归档文件夹", "归档文件的保存路径。", this.plugin.settings.archiveFolder, async (v) => {
        this.plugin.settings.archiveFolder = cleanFolderPath(v);
        await this.plugin.saveSettings();
      });
    }

    const miscOpts = createSubsection(advancedContent, "其他设置");
    textSetting(miscOpts, "图片保存文件夹", "生成的封面图片存储路径。", this.plugin.settings.bannerFolder, async (v) => {
      this.plugin.settings.bannerFolder = cleanFolderPath(v);
      await this.plugin.saveSettings();
    });

    toggleSetting(miscOpts, "输出调试日志到 Console", this.plugin.settings.debugLogging, async (v) => {
      this.plugin.settings.debugLogging = v;
      await this.plugin.saveSettings();
    });
  }

  private renderStatusBar(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: "gpx-daily-banner-status-card" });
    const header = card.createDiv({ cls: "gpx-daily-banner-status-header" });
    const titleEl = header.createDiv({ cls: "gpx-daily-banner-status-title" });
    const actionsEl = header.createDiv({ cls: "gpx-daily-banner-status-actions" });

    const refreshBtn = actionsEl.createEl("button", { text: "立即同步今天", cls: "mod-cta" });
    const guideToggleBtn = actionsEl.createEl("button", { text: "同步指南" });

    const guidePanel = card.createDiv({ cls: "gpx-daily-banner-guide-panel" });
    guidePanel.style.display = "none";

    guideToggleBtn.onclick = () => {
      const isHidden = guidePanel.style.display === "none";
      guidePanel.style.display = isHidden ? "block" : "none";
      guideToggleBtn.setText(isHidden ? "收起指南" : "同步指南");
    };

    guidePanel.createEl("p", {
      text: "只需让一生足迹把当天的 _raw 文件保存到“轨迹同步文件夹”，打开 Obsidian 即可自动读取并生成封面。"
    });
    const copyBtn = guidePanel.createEl("button", { text: "复制快捷指令配置步骤", cls: "mod-small" });
    copyBtn.onclick = () => void this.copyShortcutInstructions();

    refreshBtn.onclick = () => {
      refreshBtn.disabled = true;
      refreshBtn.setText("正在同步…");
      void (async () => {
        try {
          await this.plugin.manager.refreshTodayDailyData({ force: true, notifyMissing: true });
          await this.updateStatusContent(titleEl);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "同步失败。");
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.setText("立即同步今天");
        }
      })();
    };

    void this.updateStatusContent(titleEl);
  }

  private async updateStatusContent(titleEl: HTMLElement): Promise<void> {
    const dateKey = todayKey(this.plugin.settings);
    const fileName = dailyDataRawFileName(dateKey, this.plugin.settings);
    const result = await readDailyDataForDate(this.plugin.app.vault, this.plugin.settings, dateKey);
    titleEl.empty();

    if (result.source) {
      const row1 = titleEl.createDiv({ cls: "gpx-daily-banner-status-row is-ready" });
      row1.createEl("span", { cls: "gpx-status-indicator is-ready" });
      row1.createEl("strong", { text: `今日轨迹已就绪 (${dateKey})` });

      const row2 = titleEl.createDiv({ cls: "gpx-daily-banner-status-sub" });
      row2.createEl("span", {
        text: `文件：${result.source.path} · ${result.source.text.split(/\r\n?|\n/).filter((l) => l.trim()).length} 点`
      });

      const notePath = dailyNotePathForDate(dateKey, this.plugin.settings);
      if (!this.plugin.app.vault.getAbstractFileByPath(notePath)) {
        const row3 = titleEl.createDiv({ cls: "gpx-daily-banner-status-sub is-warning" });
        row3.createEl("span", { text: `⚠️ 尚未创建当天日记：${notePath}` });
      }
      return;
    }

    const row1 = titleEl.createDiv({ cls: "gpx-daily-banner-status-row is-waiting" });
    row1.createEl("span", { cls: "gpx-status-indicator is-waiting" });
    row1.createEl("strong", { text: `等待今日足迹同步 (${dateKey})` });

    const row2 = titleEl.createDiv({ cls: "gpx-daily-banner-status-sub" });
    row2.createEl("span", {
      text: `等待写入：${joinPath(this.plugin.settings.dailyDataBridgeFolder, fileName)}`
    });
  }

  private async copyShortcutInstructions(): Promise<void> {
    const text = [
      "GPX Daily Banner：一生足迹快捷指令同步步骤",
      "1. 计算当前日期在当前时区的当天 00:00:00。",
      "2. 转换为 Unix 时间戳（秒），拼接成 <时间戳>_raw。",
      "3. 读取一生足迹 DailyData 中的同名文件。",
      `4. 将原始内容保存到 Obsidian Vault 的“${this.plugin.settings.dailyDataBridgeFolder}”，文件名保持不变（也可保留 .csv 后缀）。`,
      "5. 回到 Obsidian 打开插件设置点击“立即同步今天”或等待启动自动读取。"
    ].join("\n");

    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      new Notice("快捷指令配置步骤已复制到剪贴板。");
    } catch {
      new Notice("无法自动复制，请直接参考设置项说明。");
    }
  }
}

function createSection(containerEl: HTMLElement, name: string, desc: string): HTMLElement {
  const section = containerEl.createDiv({ cls: "gpx-daily-banner-settings-section" });
  section.createEl("h3", { text: name });
  if (desc) {
    section.createEl("p", { cls: "gpx-daily-banner-settings-help", text: desc });
  }
  return section;
}

function createSubsection(containerEl: HTMLElement, name: string): HTMLElement {
  const section = containerEl.createDiv({ cls: "gpx-daily-banner-settings-subsection" });
  section.createEl("h4", { text: name });
  return section;
}

function textSetting(
  containerEl: HTMLElement,
  name: string,
  desc: string,
  value: string,
  onChange: (value: string) => Promise<void>,
  disabled = false
): void {
  new Setting(containerEl)
    .setName(name)
    .setDesc(desc)
    .addText((text) => text.setValue(value).setDisabled(disabled).onChange(onChange));
}

function numberSetting(containerEl: HTMLElement, name: string, value: number, min: number, max: number, onChange: (value: number) => Promise<void>): void {
  new Setting(containerEl).setName(name).addText((text) =>
    text
      .setValue(String(value))
      .onChange(async (raw) => {
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed)) return;
        await onChange(Math.max(min, Math.min(max, parsed)));
      })
  );
}

function numberSettingWithDesc(containerEl: HTMLElement, name: string, desc: string, value: number, min: number, max: number, onChange: (value: number) => Promise<void>): void {
  new Setting(containerEl).setName(name).setDesc(desc).addText((text) =>
    text
      .setValue(String(value))
      .onChange(async (raw) => {
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed)) return;
        await onChange(Math.max(min, Math.min(max, parsed)));
      })
  );
}

function toggleSetting(containerEl: HTMLElement, name: string, value: boolean, onChange: (value: boolean) => Promise<void>, desc?: string): void {
  const setting = new Setting(containerEl).setName(name);
  if (desc) setting.setDesc(desc);
  setting.addToggle((toggle) => toggle.setValue(value).onChange(onChange));
}
