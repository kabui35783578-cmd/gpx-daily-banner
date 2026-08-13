import { Notice, TFile, Vault } from "obsidian";
import { parseDailyData } from "./daily-data-parser";
import { DailyDataSource, readDailyDataForDate } from "./daily-data-source";
import { shouldBlockAutomaticGpxForDailyData } from "./daily-data-conflict";
import { parseGpx, getMetadataTime } from "./gpx-parser";
import { renderMapBanner } from "./map-renderer";
import { renderOfflineBanner } from "./offline-renderer";
import { ProcessingQueue } from "./processing-queue";
import { resolveTrackDate, todayKey } from "./track-date";
import { calculateDistanceMeters, calculateDurationMs } from "./track-metrics";
import { GpxDailyBannerSettings, DailyDataRecord, ParsedTrack, PluginData, ProcessedFileRecord, RenderInput } from "./types";
import { bannerImagePath, HERO_IMAGE_DIMENSIONS, heroImagePaths, saveBannerImage } from "./image-storage";
import { dailyNotePathForDate, extractBannerImagePaths, getOrCreateDailyNote, upsertBannerBlock } from "./daily-note";
import { cleanFilePath, debug, ensureFolder, fileIsInFolder, isGpxFile, joinPath, sanitizeFilePart, waitForStableFile } from "./utils";

export interface ProcessOptions {
  force?: boolean;
  skipStabilityCheck?: boolean;
}

export interface DailyDataProcessOptions {
  force?: boolean;
  notifyMissing?: boolean;
}

interface TrackJob {
  kind: "gpx" | "daily-data";
  sourceKey: string;
  sourcePath: string;
  sourceSize: number;
  sourceModifiedTime: number;
  dateKey: string;
  tracks: ParsedTrack[];
  force: boolean;
  file?: TFile;
  dailyData?: DailyDataSource;
}

interface RenderedImage {
  path: string;
  data: ArrayBuffer;
}

interface RenderResult {
  data: ArrayBuffer;
  usedOfflineFallback: boolean;
}

export class BannerManager {
  private queue = new ProcessingQueue();

  constructor(
    private vault: Vault,
    private getSettings: () => GpxDailyBannerSettings,
    private getData: () => PluginData,
    private saveData: () => Promise<void>
  ) {}

  async scanInbox(): Promise<void> {
    const settings = this.getSettings();
    const files = this.vault.getFiles().filter((file) => isGpxFile(file) && fileIsInFolder(file, settings.inboxFolder));
    if (!files.length) {
      new Notice("GPX 导入文件夹里没有发现 .gpx 文件。");
      return;
    }
    for (const file of files) {
      await this.processGpxFile(file);
    }
  }

  async processGpxFile(file: TFile, options: ProcessOptions = {}): Promise<void> {
    const settings = this.getSettings();
    if (!isGpxFile(file)) {
      new Notice("当前文件不是 GPX 文件。");
      return;
    }
    if (!options.force && this.isUnchangedProcessed(file)) {
      new Notice("GPX 文件已经处理，无需重复处理。");
      return;
    }
    if (this.queue.isFileActive(file.path)) return;

    const stableFile = options.skipStabilityCheck ? file : await waitForStableFile(this.vault, file);
    if (!stableFile) {
      new Notice("GPX 文件仍在同步或写入，请稍后重试。");
      return;
    }

    let xml = "";
    let tracks: ParsedTrack[] = [];
    let dateKey = "";
    try {
      xml = await this.vault.read(stableFile);
      tracks = parseGpx(xml);
      dateKey = resolveTrackDate(stableFile, tracks, getMetadataTime(xml), settings).dateKey;
    } catch (error) {
      await this.markFailed(stableFile, "", "", error);
      new Notice(error instanceof Error ? error.message : "GPX 解析失败。");
      return;
    }

    if (!options.force && await this.hasGeneratedDailyDataForDate(dateKey)) {
      new Notice(`${dateKey} 已有一生足迹轨迹，自动处理时保留 GPX 文件但不覆盖当天封面；如需使用 GPX，请执行“使用当前 GPX 覆盖日记封面”。`);
      return;
    }

    await this.queue.runForFile(stableFile.path, dateKey, async () => {
      await this.processTrackJob({
        kind: "gpx",
        sourceKey: stableFile.path,
        sourcePath: stableFile.path,
        sourceSize: stableFile.stat.size,
        sourceModifiedTime: stableFile.stat.mtime,
        dateKey,
        tracks,
        force: options.force === true,
        file: stableFile
      });
    });
  }

  async refreshTodayDailyData(options: DailyDataProcessOptions = {}): Promise<boolean> {
    return await this.refreshDailyDataForDate(todayKey(this.getSettings()), options);
  }

  async refreshDailyDataForDate(dateKey: string, options: DailyDataProcessOptions = {}): Promise<boolean> {
    const settings = this.getSettings();
    const result = await readDailyDataForDate(this.vault, settings, dateKey);
    const source = result.source;
    if (!source) {
      if (options.notifyMissing) {
        new Notice(`没有找到 ${dateKey} 的一生足迹 _raw 文件。已尝试：${result.attemptedPaths.join("、") || "未设置目录"}`);
      }
      return false;
    }

    let tracks: ParsedTrack[];
    try {
      tracks = parseDailyData(source.text, settings.dailyDataGapMinutes);
    } catch (error) {
      await this.markDailyDataFailed(dateKey, source, error);
      if (options.notifyMissing) {
        new Notice(error instanceof Error ? error.message : "一生足迹文件解析失败。");
      }
      return false;
    }

    const previous = this.getData().dailyDataRecords[dateKey];
    const needsHeroMigration = previous?.status === "processed" && await this.noteNeedsHeroImages(dateKey);
    if (!options.force && previous?.fingerprint === source.fingerprint && previous.status === "processed" && !needsHeroMigration) {
      debug(settings, "daily data unchanged", dateKey, source.path);
      return true;
    }

    await this.queue.runForFile(`daily-data:${dateKey}`, dateKey, async () => {
      await this.processTrackJob({
        kind: "daily-data",
        sourceKey: `daily-data:${dateKey}`,
        sourcePath: source.path,
        sourceSize: new TextEncoder().encode(source.text).byteLength,
        sourceModifiedTime: Date.now(),
        dateKey,
        tracks,
        force: options.force === true,
        dailyData: source
      });
    });
    return true;
  }

  private async noteNeedsHeroImages(dateKey: string): Promise<boolean> {
    const note = this.vault.getAbstractFileByPath(dailyNotePathForDate(dateKey, this.getSettings()));
    if (!(note instanceof TFile)) return true;

    const imagePaths = extractBannerImagePaths(await this.vault.read(note));
    if (imagePaths.length < 2) return true;
    return imagePaths.some((path) => !(this.vault.getAbstractFileByPath(path) instanceof TFile));
  }

  async regenerateForDate(dateKey: string): Promise<void> {
    const dailySource = await readDailyDataForDate(this.vault, this.getSettings(), dateKey);
    if (dailySource.source) {
      await this.refreshDailyDataForDate(dateKey, { force: true, notifyMissing: true });
      return;
    }

    const record = Object.values(this.getData().records).find((item) => item.trackDate === dateKey && item.status !== "failed" && !item.sourceDeleted);
    if (!record) {
      new Notice(`没有找到 ${dateKey} 的 GPX 或一生足迹处理记录。`);
      return;
    }
    const file = this.vault.getAbstractFileByPath(record.path);
    if (file instanceof TFile) {
      await this.processGpxFile(file, { force: true, skipStabilityCheck: true });
    } else {
      new Notice("找不到原始 GPX 文件，无法重新生成。");
    }
  }

  async regenerateAllProcessed(): Promise<number> {
    const dateKeys = new Set([
      ...Object.values(this.getData().records).filter((record) => record.status === "processed" && !record.sourceDeleted).map((record) => record.trackDate),
      ...Object.values(this.getData().dailyDataRecords).filter((record) => record.status === "processed").map((record) => record.dateKey)
    ]);
    for (const dateKey of dateKeys) {
      await this.regenerateForDate(dateKey);
    }
    return dateKeys.size;
  }

  async retryPendingForNote(notePath: string): Promise<void> {
    const pending = Object.values(this.getData().records).filter((record) => record.status === "pending-note" && record.notePath === notePath);
    for (const record of pending) {
      const file = this.vault.getAbstractFileByPath(record.path);
      if (file instanceof TFile) {
        await this.processGpxFile(file, { force: true, skipStabilityCheck: true });
      }
    }

    const pendingDaily = Object.values(this.getData().dailyDataRecords).filter((record) => record.status === "pending-note" && record.notePath === notePath);
    for (const record of pendingDaily) {
      await this.refreshDailyDataForDate(record.dateKey, { force: true });
    }
  }

  private async processTrackJob(job: TrackJob): Promise<void> {
    const settings = this.getSettings();
    const notePath = dailyNotePathForDate(job.dateKey, settings);
    const note = await getOrCreateDailyNote(this.vault, job.dateKey, settings);
    if (!note) {
      if (job.kind === "gpx" && job.file) {
        await this.upsertRecord({
          path: job.file.path,
          size: job.file.stat.size,
          modifiedTime: job.file.stat.mtime,
          trackDate: job.dateKey,
          imagePath: bannerImagePath(job.dateKey, settings),
          notePath,
          status: "pending-note"
        });
      } else if (job.dailyData) {
        await this.upsertDailyDataRecord({
          sourceKind: job.dailyData.kind,
          sourcePath: job.dailyData.path,
          dateKey: job.dateKey,
          fingerprint: job.dailyData.fingerprint,
          pointCount: countTrackPoints(job.tracks),
          imagePath: bannerImagePath(job.dateKey, settings),
          notePath,
          status: "pending-note"
        });
      }
      return;
    }

    const renderTracks = job.kind === "gpx" && settings.sameDayMode === "merge" && job.file
      ? await this.collectTracksForDate(job.dateKey, job.file, job.tracks)
      : job.tracks;
    const input: RenderInput = {
      tracks: renderTracks,
      dateKey: job.dateKey,
      stats: {
        dateLabel: job.dateKey,
        distanceMeters: calculateDistanceMeters(renderTracks),
        durationMs: calculateDurationMs(renderTracks)
      }
    };

    const imagePath = bannerImagePath(job.dateKey, settings);
    const heroPaths = heroImagePaths(job.dateKey, settings);
    const renderedImages: RenderedImage[] = [];
    let usedOfflineFallback = false;
    try {
      const bannerResult = await this.renderImage(input, settings);
      renderedImages.push({ path: imagePath, data: bannerResult.data });
      usedOfflineFallback = bannerResult.usedOfflineFallback;

      for (const variant of ["desktop", "mobile"] as const) {
        const dimensions = HERO_IMAGE_DIMENSIONS[variant];
        const heroSettings = {
          ...settings,
          imageWidth: dimensions.width,
          imageHeight: dimensions.height
        };
        const heroInput: RenderInput = {
          ...input,
          viewportPadding: Math.round(Math.min(dimensions.width, dimensions.height) * 0.13)
        };
        const heroResult = await this.renderImage(heroInput, heroSettings);
        renderedImages.push({ path: heroPaths[variant], data: heroResult.data });
        usedOfflineFallback = usedOfflineFallback || heroResult.usedOfflineFallback;
      }
    } catch (error) {
      await this.markJobFailed(job, note.path, error);
      if (settings.onlineMapEnabled && !settings.offlineFallback) {
        new Notice("地图瓦片加载失败，且未开启离线图。");
      } else {
        new Notice(error instanceof Error ? error.message : "轨迹封面生成失败。");
      }
      return;
    }

    try {
      for (const renderedImage of renderedImages) {
        await saveBannerImage(this.vault, renderedImage.path, renderedImage.data);
      }
    } catch (error) {
      await this.markJobFailed(job, note.path, error);
      debug(settings, "save rendered images failed", error);
      new Notice("图片保存失败。");
      return;
    }

    if (usedOfflineFallback) {
      new Notice("地图瓦片加载失败，已生成离线轨迹图。");
    }

    try {
      await upsertBannerBlock(this.vault, note, heroPaths);
    } catch (error) {
      await this.markJobFailed(job, note.path, error);
      new Notice("日记写入失败。");
      return;
    }

    let recordPath = job.sourcePath;
    let sourceDeleted = false;
    // A manually imported GPX can live in the Vault's attachments folder (or any
    // other Vault folder), so cleanup must not depend on the scan-only Inbox path.
    // DailyData sources never enter this branch and are therefore never deleted.
    if (job.kind === "gpx" && job.file) {
      if (settings.autoDeleteAfterSuccess) {
        try {
          await this.vault.delete(job.file);
          sourceDeleted = true;
        } catch (error) {
          new Notice("GPX 删除失败，但图片和日记已处理完成。");
          debug(settings, "delete source GPX failed", error);
        }
      } else if (settings.archiveAfterSuccess) {
        try {
          recordPath = await this.archiveFile(job.file);
        } catch (error) {
          new Notice("GPX 归档失败，但图片和日记已处理完成。");
          debug(settings, "archive failed", error);
        }
      }
    }

    if (job.kind === "gpx" && job.file) {
      await this.upsertRecord(
        {
          path: recordPath,
          size: job.sourceSize,
          modifiedTime: job.sourceModifiedTime,
          trackDate: job.dateKey,
          imagePath,
          notePath: note.path,
          status: "processed",
          sourceDeleted
        },
        recordPath !== job.file.path ? job.file.path : undefined
      );
    } else if (job.dailyData) {
      await this.upsertDailyDataRecord({
        sourceKind: job.dailyData.kind,
        sourcePath: job.dailyData.path,
        dateKey: job.dateKey,
        fingerprint: job.dailyData.fingerprint,
        pointCount: countTrackPoints(job.tracks),
        imagePath,
        notePath: note.path,
        status: "processed"
      });
    }
    if (job.kind === "daily-data") {
      new Notice(job.force ? "今天的一生足迹轨迹已重新生成。" : "今天的一生足迹轨迹已生成。");
    } else if (sourceDeleted) {
      new Notice("GPX 轨迹封面已生成，原始 GPX 已删除。");
    } else {
      new Notice("GPX 轨迹封面已生成。");
    }
  }

  private async renderImage(input: RenderInput, settings: GpxDailyBannerSettings): Promise<RenderResult> {
    if (!settings.onlineMapEnabled) {
      return {
        data: await renderOfflineBanner(input, settings, "在线地图已关闭"),
        usedOfflineFallback: false
      };
    }

    try {
      return {
        data: await renderMapBanner(input, settings),
        usedOfflineFallback: false
      };
    } catch (error) {
      debug(settings, "online render failed", error);
      if (!settings.offlineFallback) throw error;
      return {
        data: await renderOfflineBanner(input, settings, "地图底图加载失败"),
        usedOfflineFallback: true
      };
    }
  }

  private async collectTracksForDate(dateKey: string, currentFile: TFile, currentTracks: ParsedTrack[]): Promise<ParsedTrack[]> {
    const records = Object.values(this.getData().records).filter((record) => record.trackDate === dateKey && record.status !== "failed" && !record.sourceDeleted);
    const paths = new Set(records.map((record) => record.path));
    paths.add(currentFile.path);
    const tracks: ParsedTrack[] = [];
    for (const path of paths) {
      if (path === currentFile.path) {
        tracks.push(...currentTracks);
        continue;
      }
      const file = this.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      try {
        tracks.push(...parseGpx(await this.vault.read(file)));
      } catch (error) {
        debug(this.getSettings(), "skip old gpx while merging", path, error);
      }
    }
    return tracks.length ? tracks : currentTracks;
  }

  private async hasGeneratedDailyDataForDate(dateKey: string): Promise<boolean> {
    const record = this.getData().dailyDataRecords[dateKey];
    if (record?.status !== "processed") return false;
    const hasCompleteBanner = !(await this.noteNeedsHeroImages(dateKey));
    return shouldBlockAutomaticGpxForDailyData(record, hasCompleteBanner);
  }

  private isUnchangedProcessed(file: TFile): boolean {
    const record = this.getData().records[file.path];
    return Boolean(record && !record.sourceDeleted && record.size === file.stat.size && record.modifiedTime === file.stat.mtime && record.status === "processed");
  }

  private async markFailed(file: TFile, trackDate: string, notePath: string, error: unknown): Promise<void> {
    await this.upsertRecord({
      path: file.path,
      size: file.stat.size,
      modifiedTime: file.stat.mtime,
      trackDate,
      imagePath: trackDate ? bannerImagePath(trackDate, this.getSettings()) : "",
      notePath,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }

  private async markDailyDataFailed(dateKey: string, source: DailyDataSource, error: unknown): Promise<void> {
    await this.upsertDailyDataRecord({
      sourceKind: source.kind,
      sourcePath: source.path,
      dateKey,
      fingerprint: source.fingerprint,
      pointCount: 0,
      imagePath: bannerImagePath(dateKey, this.getSettings()),
      notePath: dailyNotePathForDate(dateKey, this.getSettings()),
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }

  private async markJobFailed(job: TrackJob, notePath: string, error: unknown): Promise<void> {
    if (job.kind === "gpx" && job.file) {
      await this.markFailed(job.file, job.dateKey, notePath, error);
      return;
    }
    if (job.dailyData) {
      await this.upsertDailyDataRecord({
        sourceKind: job.dailyData.kind,
        sourcePath: job.dailyData.path,
        dateKey: job.dateKey,
        fingerprint: job.dailyData.fingerprint,
        pointCount: countTrackPoints(job.tracks),
        imagePath: bannerImagePath(job.dateKey, this.getSettings()),
        notePath,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async upsertRecord(record: ProcessedFileRecord, oldPath?: string): Promise<void> {
    const data = this.getData();
    if (oldPath && oldPath !== record.path) {
      delete data.records[oldPath];
    }
    data.records[record.path] = record;
    await this.saveData();
  }

  private async upsertDailyDataRecord(record: DailyDataRecord): Promise<void> {
    this.getData().dailyDataRecords[record.dateKey] = record;
    await this.saveData();
  }

  private async archiveFile(file: TFile): Promise<string> {
    const settings = this.getSettings();
    await ensureFolder(this.vault, settings.archiveFolder);
    const originalName = file.name;
    const dot = originalName.lastIndexOf(".");
    const stem = sanitizeFilePart(dot === -1 ? originalName : originalName.slice(0, dot));
    const ext = dot === -1 ? "" : originalName.slice(dot);
    let target = cleanFilePath(joinPath(settings.archiveFolder, `${stem}${ext}`));
    let counter = 1;
    while (this.vault.getAbstractFileByPath(target)) {
      target = cleanFilePath(joinPath(settings.archiveFolder, `${stem}-${counter}${ext}`));
      counter++;
    }
    await this.vault.rename(file, target);
    return target;
  }
}

function countTrackPoints(tracks: ParsedTrack[]): number {
  return tracks.reduce((total, track) => total + track.segments.reduce((sum, segment) => sum + segment.points.length, 0), 0);
}
