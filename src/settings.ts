import { App, Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type GpxDailyBannerPlugin from "./main";
import { AMAP_CLEAN_TILE_URL, DEFAULT_MAP_TILE_PRESET_ID, getMapTilePreset, MAP_TILE_PRESETS } from "./map-presets";
import { DailyDataSourceMode, GpxDailyBannerSettings, MapCoordinateSystem, MapTilePresetId, SameDayMode, TimezoneMode } from "./types";
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
  desktopBannerHeight: 220,
  mobileBannerHeight: 180,
  bannerRadius: 12,
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
  sameDayMode: "merge",
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

    new Setting(containerEl).setName("GPX Daily Banner").setHeading();
    containerEl.createEl("p", {
      cls: "gpx-daily-banner-settings-intro",
      text: "把一生足迹当天的轨迹自动生成地图封面，并插入你的 Obsidian 日记。移动端主流程使用快捷指令同步。"
    });

    this.renderSetupGuide(containerEl);

    const basic = createSection(
      containerEl,
      "基础设置",
      "只需要配置这些选项，就可以完成大多数移动端使用场景。"
    );

    textSetting(
      basic,
      "轨迹同步文件夹",
      "一生足迹快捷指令把当天文件保存到这里。文件名应保持为当天时间戳加 _raw，也兼容 .csv 后缀。",
      this.plugin.settings.dailyDataBridgeFolder,
      async (value) => {
        this.plugin.settings.dailyDataBridgeFolder = cleanFolderPath(value) || DEFAULT_SETTINGS.dailyDataBridgeFolder;
        await this.plugin.saveSettings();
      }
    );

    if (this.plugin.settings.dailyDataSourceMode === "external") {
      const legacy = basic.createDiv({ cls: "gpx-daily-banner-legacy-warning" });
      legacy.createEl("strong", { text: "正在兼容旧版外部目录模式" });
      legacy.createEl("span", { text: "新用户请使用“快捷指令同步”。切换后，插件会从上面的轨迹同步文件夹读取。" });
      const migrate = legacy.createEl("button", { text: "切换到快捷指令同步" });
      migrate.onclick = async () => {
        this.plugin.settings.dailyDataSourceMode = "bridge";
        await this.plugin.saveSettings();
        this.display();
      };
    }

    new Setting(basic)
      .setName("日记配置来源")
      .setDesc("开启后优先跟随 Obsidian 核心 Daily Notes 设置；关闭后可以手动指定路径。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useCoreDailyNotesSettings).onChange(async (value) => {
          this.plugin.settings.useCoreDailyNotesSettings = value;
          if (value && !this.plugin.syncDailyNotesSettingsFromCore()) {
            new Notice("没有读取到核心 Daily Notes 设置，请检查该核心插件是否启用。");
          }
          await this.plugin.saveSettings();
          this.display();
        })
      );

    textSetting(
      basic,
      "日记文件夹",
      this.plugin.settings.useCoreDailyNotesSettings ? "当前值来自 Obsidian 核心 Daily Notes。关闭上面的自动跟随后可手动编辑。" : "例如 Daily Notes；支持留空表示 Vault 根目录。",
      this.plugin.settings.dailyNoteFolder,
      async (value) => {
        this.plugin.settings.dailyNoteFolder = cleanFolderPath(value);
        await this.plugin.saveSettings();
      },
      this.plugin.settings.useCoreDailyNotesSettings
    );

    textSetting(
      basic,
      "日记日期格式",
      "支持 YYYY、MM、DD，也可以包含 / 形成子文件夹。",
      this.plugin.settings.dailyNoteDateFormat,
      async (value) => {
        this.plugin.settings.dailyNoteDateFormat = normalizePath(value.trim() || DEFAULT_SETTINGS.dailyNoteDateFormat);
        await this.plugin.saveSettings();
      },
      this.plugin.settings.useCoreDailyNotesSettings
    );

    textSetting(
      basic,
      "日记文件扩展名",
      "通常是 md。",
      this.plugin.settings.dailyNoteExtension,
      async (value) => {
        this.plugin.settings.dailyNoteExtension = value.trim().replace(/^\./, "") || "md";
        await this.plugin.saveSettings();
      },
      this.plugin.settings.useCoreDailyNotesSettings
    );

    toggleSetting(
      basic,
      "日记不存在时自动创建",
      this.plugin.settings.autoCreateDailyNote,
      async (value) => {
        this.plugin.settings.autoCreateDailyNote = value;
        await this.plugin.saveSettings();
      },
      "关闭时，插件会保留待处理状态并提示你先创建当天日记。"
    );

    toggleSetting(
      basic,
      "使用在线地图底图",
      this.plugin.settings.onlineMapEnabled,
      async (value) => {
        this.plugin.settings.onlineMapEnabled = value;
        await this.plugin.saveSettings();
        if (!value) {
          new Notice("已切换为仅生成离线轨迹图；之后重新生成的封面不会请求在线地图瓦片。");
        }
      },
      "在线地图会向地图服务商发送轨迹所在区域的瓦片请求；关闭后只绘制离线轨迹。"
    );

    const advanced = containerEl.createEl("details", { cls: "gpx-daily-banner-settings-advanced" });
    advanced.createEl("summary", { text: "高级设置" });
    const advancedContent = advanced.createDiv({ cls: "gpx-daily-banner-settings-advanced-content" });
    advancedContent.createEl("p", {
      cls: "gpx-daily-banner-settings-help",
      text: "这些选项适合需要调整渲染效果、时间边界或 GPX 辅助功能的用户。默认值已经适合移动端主流程。"
    });

    const sync = createSubsection(advancedContent, "同步与时间");
    numberSettingWithDesc(sync, "长时间断档阈值（分钟）", "超过这个时间没有记录，就不把上一段尾点和下一段首点连成直线。", this.plugin.settings.dailyDataGapMinutes, 1, 1440, async (value) => {
      this.plugin.settings.dailyDataGapMinutes = value;
      await this.plugin.saveSettings();
    });
    numberSettingWithDesc(sync, "打开 Obsidian 后读取延迟（秒）", "快捷指令或同步较慢时可适当增加；插件会在启动时有限重试，并在轨迹同步文件变化时自动读取，不后台轮询。", this.plugin.settings.dailyDataStartupDelaySeconds, 0, 60, async (value) => {
      this.plugin.settings.dailyDataStartupDelaySeconds = value;
      await this.plugin.saveSettings();
    });
    new Setting(sync)
      .setName("时区模式")
      .setDesc("用于计算一生足迹当天文件名和 GPX 日期。移动端通常使用设备本地时区。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", "设备本地时区")
          .addOption("utc", "UTC")
          .addOption("offset", "自定义时区偏移")
          .setValue(this.plugin.settings.timezoneMode)
          .onChange(async (value) => {
            this.plugin.settings.timezoneMode = value as TimezoneMode;
            await this.plugin.saveSettings();
          })
      );
    numberSetting(sync, "自定义时区偏移分钟", this.plugin.settings.customTimezoneOffsetMinutes, -720, 840, async (value) => {
      this.plugin.settings.customTimezoneOffsetMinutes = value;
      await this.plugin.saveSettings();
    });

    const rendering = createSubsection(advancedContent, "封面与地图");
    textSetting(rendering, "图片保存文件夹", "生成的 PNG 会保存到这里。", this.plugin.settings.bannerFolder, async (value) => {
      this.plugin.settings.bannerFolder = cleanFolderPath(value);
      await this.plugin.saveSettings();
    });
    numberSetting(rendering, "图片宽度", this.plugin.settings.imageWidth, 640, 3200, async (value) => {
      this.plugin.settings.imageWidth = value;
      await this.plugin.saveSettings();
    });
    numberSetting(rendering, "图片高度", this.plugin.settings.imageHeight, 240, 1600, async (value) => {
      this.plugin.settings.imageHeight = value;
      await this.plugin.saveSettings();
    });
    numberSetting(rendering, "桌面端封面高度", this.plugin.settings.desktopBannerHeight, 120, 600, async (value) => {
      this.plugin.settings.desktopBannerHeight = value;
      await this.plugin.saveSettings();
      this.plugin.applyStyleVariables();
    });
    numberSetting(rendering, "手机端封面高度", this.plugin.settings.mobileBannerHeight, 100, 500, async (value) => {
      this.plugin.settings.mobileBannerHeight = value;
      await this.plugin.saveSettings();
      this.plugin.applyStyleVariables();
    });
    numberSetting(rendering, "封面圆角", this.plugin.settings.bannerRadius, 0, 40, async (value) => {
      this.plugin.settings.bannerRadius = value;
      await this.plugin.saveSettings();
      this.plugin.applyStyleVariables();
    });

    new Setting(rendering)
      .setName("地图背景")
      .setDesc("默认使用高德清爽标注底图；选定源失败时会依次尝试国内备用源和 CARTO，最后仍可生成离线轨迹图。")
      .addDropdown((dropdown) => {
        for (const preset of MAP_TILE_PRESETS) dropdown.addOption(preset.id, preset.name);
        dropdown.addOption("custom", "自定义");
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
          void this.plugin.regenerateAllBanners("地图背景已保存，正在重新生成已有轨迹封面。");
        });
      });

    new Setting(rendering)
      .setName("轨迹坐标系")
      .setDesc("手机 GPS 通常是 WGS84；使用高德或腾讯地图时，插件会在中国境内自动转换到 GCJ-02。若你的原始文件已经纠偏，请选择 GCJ-02。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("wgs84", "WGS84（手机 GPS，推荐）")
          .addOption("gcj02", "GCJ-02（已转换数据）")
          .setValue(this.plugin.settings.trackCoordinateSystem)
          .onChange(async (value) => {
            this.plugin.settings.trackCoordinateSystem = value as MapCoordinateSystem;
            await this.plugin.saveSettings();
            void this.plugin.regenerateAllBanners("轨迹坐标系已保存，正在重新生成已有轨迹封面。");
          })
      );

    textSetting(rendering, "天地图 TK（可选）", "选择天地图矢量时填写自己的 TK；只保存在当前 Vault 的插件设置中，不会写入仓库。", this.plugin.settings.mapTileToken, async (value) => {
      this.plugin.settings.mapTileToken = value.trim();
      await this.plugin.saveSettings();
    });

    new Setting(rendering)
      .setName("重新生成已有封面")
      .setDesc("地图背景或样式改动后，用这个按钮覆盖更新已经插入日记的 PNG。")
      .addButton((button) =>
        button
          .setButtonText("重新生成")
          .setCta()
          .onClick(() => {
            void this.plugin.regenerateAllBanners("正在重新生成已有轨迹封面。");
          })
      );
    textSetting(rendering, "地图瓦片地址", "自定义时可填写 {z}/{x}/{y}；国内源还支持 {s}、{reverseY}、{sx}、{sy} 和 {token} 占位。", this.plugin.settings.tileUrlTemplate, async (value) => {
      this.plugin.settings.mapTilePreset = "custom";
      this.plugin.settings.tileUrlTemplate = value.trim() || DEFAULT_SETTINGS.tileUrlTemplate;
      await this.plugin.saveSettings();
    });
    textSetting(rendering, "地图版权文字", "在线地图封面右下角会显示这段文字。", this.plugin.settings.tileAttribution, async (value) => {
      this.plugin.settings.mapTilePreset = "custom";
      this.plugin.settings.tileAttribution = value.trim() || DEFAULT_SETTINGS.tileAttribution;
      await this.plugin.saveSettings();
    });
    numberSetting(rendering, "地图最大缩放级别", this.plugin.settings.maxZoom, 1, 20, async (value) => {
      this.plugin.settings.mapTilePreset = "custom";
      this.plugin.settings.maxZoom = value;
      await this.plugin.saveSettings();
    });
    numberSetting(rendering, "最大地图瓦片数量", this.plugin.settings.maxTileCount, 4, 64, async (value) => {
      this.plugin.settings.maxTileCount = value;
      await this.plugin.saveSettings();
    });
    toggleSetting(rendering, "在线地图失败时生成离线图", this.plugin.settings.offlineFallback, async (value) => {
      this.plugin.settings.offlineFallback = value;
      await this.plugin.saveSettings();
    });
    textSetting(rendering, "轨迹线颜色", "十六进制颜色，例如 #ef4444。", this.plugin.settings.trackColor, async (value) => {
      this.plugin.settings.trackColor = value.trim() || DEFAULT_SETTINGS.trackColor;
      await this.plugin.saveSettings();
    });
    numberSetting(rendering, "轨迹线宽度", this.plugin.settings.trackLineWidth, 1, 20, async (value) => {
      this.plugin.settings.trackLineWidth = value;
      await this.plugin.saveSettings();
    });
    toggleSetting(rendering, "显示起点", this.plugin.settings.showStartMarker, async (value) => {
      this.plugin.settings.showStartMarker = value;
      await this.plugin.saveSettings();
    });
    toggleSetting(rendering, "显示终点", this.plugin.settings.showEndMarker, async (value) => {
      this.plugin.settings.showEndMarker = value;
      await this.plugin.saveSettings();
    });
    toggleSetting(rendering, "显示日期", this.plugin.settings.showDate, async (value) => {
      this.plugin.settings.showDate = value;
      await this.plugin.saveSettings();
    });
    toggleSetting(rendering, "显示距离", this.plugin.settings.showDistance, async (value) => {
      this.plugin.settings.showDistance = value;
      await this.plugin.saveSettings();
    });
    toggleSetting(rendering, "显示运动时长", this.plugin.settings.showDuration, async (value) => {
      this.plugin.settings.showDuration = value;
      await this.plugin.saveSettings();
    });

    const gpx = createSubsection(advancedContent, "GPX 辅助功能");
    textSetting(gpx, "GPX 导入文件夹", "只影响“扫描 GPX 导入文件夹”命令；一生足迹快捷指令同步不使用这里。", this.plugin.settings.inboxFolder, async (value) => {
      this.plugin.settings.inboxFolder = cleanFolderPath(value);
      await this.plugin.saveSettings();
    });
    new Setting(gpx)
      .setName("同一天多个 GPX")
      .setDesc("保留给手动 GPX 导入使用。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("merge", "合并模式")
          .addOption("replace", "覆盖模式")
          .setValue(this.plugin.settings.sameDayMode)
          .onChange(async (value) => {
            this.plugin.settings.sameDayMode = value as SameDayMode;
            await this.plugin.saveSettings();
          })
      );
    toggleSetting(gpx, "处理成功后归档 GPX", this.plugin.settings.archiveAfterSuccess, async (value) => {
      this.plugin.settings.archiveAfterSuccess = value;
      await this.plugin.saveSettings();
    });
    textSetting(gpx, "GPX 归档文件夹", "开启归档后，成功处理的 GPX 会移动到这里。", this.plugin.settings.archiveFolder, async (value) => {
      this.plugin.settings.archiveFolder = cleanFolderPath(value);
      await this.plugin.saveSettings();
    });
    toggleSetting(gpx, "处理成功后自动删除 GPX", this.plugin.settings.autoDeleteAfterSuccess, async (value) => {
      this.plugin.settings.autoDeleteAfterSuccess = value;
      await this.plugin.saveSettings();
    }, "只影响手动 GPX 源文件；一生足迹文件不会被删除。默认关闭。");
    toggleSetting(gpx, "调试日志", this.plugin.settings.debugLogging, async (value) => {
      this.plugin.settings.debugLogging = value;
      await this.plugin.saveSettings();
    });
  }

  private renderSetupGuide(containerEl: HTMLElement): void {
    const guide = containerEl.createDiv({ cls: "gpx-daily-banner-setup" });
    guide.createEl("h2", { text: "开始使用" });
    guide.createEl("p", {
      text: "只需让一生足迹把当天的 _raw 文件同步到轨迹同步文件夹，插件就会在打开 Obsidian 后读取并生成日记封面。"
    });

    const steps = guide.createEl("ol");
    steps.createEl("li", { text: "在下方确认轨迹同步文件夹和日记配置。" });
    steps.createEl("li", { text: "用快捷指令计算当天 00:00 的 Unix 秒时间戳，并读取对应的 _raw 文件。" });
    steps.createEl("li", { text: "把文件原名保存到轨迹同步文件夹，回到 Obsidian 等待启动读取或手动刷新。" });

    const status = guide.createDiv({ cls: "gpx-daily-banner-setup-status", attr: { "aria-live": "polite" } });
    status.setText("正在检查今天的轨迹文件……");
    void this.updateSetupStatus(status);

    const actions = guide.createDiv({ cls: "gpx-daily-banner-setup-actions" });
    const refresh = actions.createEl("button", { text: "重新读取今天文件", cls: "mod-cta" });
    refresh.onclick = () => {
      refresh.disabled = true;
      void (async () => {
        try {
          await this.plugin.manager.refreshTodayDailyData({ force: true, notifyMissing: true });
          await this.updateSetupStatus(status);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "读取今天轨迹失败。");
        } finally {
          refresh.disabled = false;
        }
      })();
    };

    const copy = actions.createEl("button", { text: "复制快捷指令配置步骤" });
    copy.onclick = () => {
      void this.copyShortcutInstructions();
    };
  }

  private async updateSetupStatus(element: HTMLElement): Promise<void> {
    const dateKey = todayKey(this.plugin.settings);
    const fileName = dailyDataRawFileName(dateKey, this.plugin.settings);
    const result = await readDailyDataForDate(this.plugin.app.vault, this.plugin.settings, dateKey);
    element.empty();
    element.classList.remove("is-ready", "is-missing");
    if (result.source) {
      element.classList.add("is-ready");
      element.createEl("strong", { text: "已找到今天的轨迹文件" });
      element.createEl("span", { text: `${result.source.path} · ${result.source.text.split(/\r\n?|\n/).filter((line) => line.trim()).length} 行` });
      const notePath = dailyNotePathForDate(dateKey, this.plugin.settings);
      if (!this.plugin.app.vault.getAbstractFileByPath(notePath)) {
        element.classList.remove("is-ready");
        element.classList.add("is-missing");
        element.createEl("span", { text: `还没有找到当天日记：${notePath}；可打开“日记不存在时自动创建”，或先创建这篇日记。` });
      }
      return;
    }

    element.classList.add("is-missing");
    element.createEl("strong", { text: "尚未找到今天的轨迹文件" });
    element.createEl("span", { text: `预期位置：${joinPath(this.plugin.settings.dailyDataBridgeFolder, fileName)} 或 ${fileName}.csv` });
  }

  private async copyShortcutInstructions(): Promise<void> {
    const text = [
      "GPX Daily Banner：一生足迹快捷指令同步步骤",
      "1. 计算当前日期在当前时区的当天 00:00:00。",
      "2. 转换为 Unix 时间戳（秒），拼接成 <时间戳>_raw。",
      "3. 读取一生足迹 DailyData 中的同名文件。",
      `4. 将原始内容保存到 Obsidian Vault 的“${this.plugin.settings.dailyDataBridgeFolder}”，文件名保持不变（也可保留 .csv 后缀）。`,
      "5. 打开 Obsidian 后插件会读取当天文件；如同步较慢，请在设置中点击“重新读取今天文件”。",
      "不要读取或覆盖 _clean 文件，也不要修改一生足迹原目录中的文件。"
    ].join("\n");

    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      new Notice("快捷指令配置步骤已复制。");
    } catch {
      new Notice("无法自动复制，请直接参考设置页中的步骤。");
    }
  }
}

function createSection(containerEl: HTMLElement, name: string, desc: string): HTMLElement {
  const section = containerEl.createDiv({ cls: "gpx-daily-banner-settings-section" });
  section.createEl("h2", { text: name });
  section.createEl("p", { cls: "gpx-daily-banner-settings-help", text: desc });
  return section;
}

function createSubsection(containerEl: HTMLElement, name: string): HTMLElement {
  const section = containerEl.createDiv({ cls: "gpx-daily-banner-settings-subsection" });
  section.createEl("h3", { text: name });
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
