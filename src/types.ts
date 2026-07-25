export type TimezoneMode = "local" | "utc" | "offset";
export type SameDayMode = "merge" | "replace";
export type ProcessStatus = "processed" | "pending-note" | "failed";
export type DailyDataSourceKind = "external" | "bridge";
export type DailyDataSourceMode = "external" | "bridge";
export type MapTilePresetId = "carto-light" | "carto-voyager" | "carto-dark" | "osm-standard" | "opentopomap" | "custom";

export interface TrackPoint {
  lat: number;
  lon: number;
  elevation?: number;
  time?: Date;
}

export interface TrackSegment {
  points: TrackPoint[];
}

export interface ParsedTrack {
  name?: string;
  segments: TrackSegment[];
  startTime?: Date;
  endTime?: Date;
}

export interface ProcessedFileRecord {
  path: string;
  size: number;
  modifiedTime: number;
  trackDate: string;
  imagePath: string;
  notePath: string;
  status: ProcessStatus;
  sourceDeleted?: boolean;
  error?: string;
}

export interface DailyDataRecord {
  sourceKind: DailyDataSourceKind;
  sourcePath: string;
  dateKey: string;
  fingerprint: string;
  pointCount: number;
  imagePath: string;
  notePath: string;
  status: ProcessStatus;
  error?: string;
}

export interface PluginData {
  records: Record<string, ProcessedFileRecord>;
  dailyDataRecords: Record<string, DailyDataRecord>;
}

export interface GpxDailyBannerSettings {
  inboxFolder: string;
  lifeFootprintFolder: string;
  dailyDataBridgeFolder: string;
  dailyDataSourceMode: DailyDataSourceMode;
  dailyDataGapMinutes: number;
  dailyDataStartupDelaySeconds: number;
  dailyNoteFolder: string;
  dailyNoteDateFormat: string;
  dailyNoteExtension: string;
  useCoreDailyNotesSettings: boolean;
  autoCreateDailyNote: boolean;
  bannerFolder: string;
  imageWidth: number;
  imageHeight: number;
  desktopBannerHeight: number;
  mobileBannerHeight: number;
  bannerRadius: number;
  mapTilePreset: MapTilePresetId;
  tileUrlTemplate: string;
  tileAttribution: string;
  maxZoom: number;
  maxTileCount: number;
  trackColor: string;
  trackColors: string[];
  trackLineWidth: number;
  showStartMarker: boolean;
  showEndMarker: boolean;
  showDate: boolean;
  showDistance: boolean;
  showDuration: boolean;
  timezoneMode: TimezoneMode;
  customTimezoneOffsetMinutes: number;
  sameDayMode: SameDayMode;
  onlineMapEnabled: boolean;
  offlineFallback: boolean;
  archiveAfterSuccess: boolean;
  autoDeleteAfterSuccess: boolean;
  archiveFolder: string;
  debugLogging: boolean;
}

export interface RenderStats {
  distanceMeters?: number;
  durationMs?: number;
  dateLabel: string;
}

export interface RenderInput {
  tracks: ParsedTrack[];
  dateKey: string;
  stats: RenderStats;
}

export interface TileLoadResult {
  image: HTMLImageElement;
  url: string;
}
