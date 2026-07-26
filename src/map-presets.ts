import { MapCoordinateSystem, MapTilePresetId, TileYMode } from "./types";

export interface MapTilePreset {
  id: MapTilePresetId;
  name: string;
  tileUrlTemplate: string;
  tileAttribution: string;
  maxZoom: number;
  coordinateSystem: MapCoordinateSystem;
  subdomains: readonly string[];
  tileYMode: TileYMode;
  requiresToken?: boolean;
}

const DEFAULT_SUBDOMAINS = ["a", "b", "c", "d"] as const;
const AMAP_SUBDOMAINS = ["1", "2", "3", "4"] as const;
const TENCENT_SUBDOMAINS = ["0", "1", "2"] as const;
const TIANDITU_SUBDOMAINS = ["0", "1", "2", "3", "4", "5", "6", "7"] as const;

export const DEFAULT_MAP_TILE_PRESET_ID: MapTilePresetId = "amap-standard";

export const MAP_TILE_PRESETS: MapTilePreset[] = [
  {
    id: "amap-standard",
    name: "高德标准（国内优先）",
    tileUrlTemplate: "https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&size=1&scl=1&style=8&ltype=11",
    tileAttribution: "© 高德地图",
    maxZoom: 18,
    coordinateSystem: "gcj02",
    subdomains: AMAP_SUBDOMAINS,
    tileYMode: "xyz"
  },
  {
    id: "amap-satellite",
    name: "高德卫星影像（国内）",
    tileUrlTemplate: "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
    tileAttribution: "© 高德地图",
    maxZoom: 18,
    coordinateSystem: "gcj02",
    subdomains: AMAP_SUBDOMAINS,
    tileYMode: "xyz"
  },
  {
    id: "tencent-satellite",
    name: "腾讯卫星影像（国内备用）",
    tileUrlTemplate: "https://p{s}.map.gtimg.com/sateTiles/{z}/{sx}/{sy}/{x}_{reverseY}.jpg",
    tileAttribution: "© 腾讯地图",
    maxZoom: 18,
    coordinateSystem: "gcj02",
    subdomains: TENCENT_SUBDOMAINS,
    tileYMode: "tencent"
  },
  {
    id: "tianditu-vector",
    name: "天地图矢量（需 TK）",
    tileUrlTemplate: "https://t{s}.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk={token}",
    tileAttribution: "© 天地图",
    maxZoom: 18,
    coordinateSystem: "wgs84",
    subdomains: TIANDITU_SUBDOMAINS,
    tileYMode: "xyz",
    requiresToken: true
  },
  {
    id: "carto-light",
    name: "CARTO Light",
    tileUrlTemplate: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    tileAttribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20,
    coordinateSystem: "wgs84",
    subdomains: DEFAULT_SUBDOMAINS,
    tileYMode: "xyz"
  },
  {
    id: "carto-voyager",
    name: "CARTO Voyager",
    tileUrlTemplate: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    tileAttribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20,
    coordinateSystem: "wgs84",
    subdomains: DEFAULT_SUBDOMAINS,
    tileYMode: "xyz"
  },
  {
    id: "carto-dark",
    name: "CARTO Dark",
    tileUrlTemplate: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    tileAttribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20,
    coordinateSystem: "wgs84",
    subdomains: DEFAULT_SUBDOMAINS,
    tileYMode: "xyz"
  },
  {
    id: "osm-standard",
    name: "OpenStreetMap Standard",
    tileUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileAttribution: "© OpenStreetMap contributors",
    maxZoom: 19,
    coordinateSystem: "wgs84",
    subdomains: [""],
    tileYMode: "xyz"
  },
  {
    id: "opentopomap",
    name: "OpenTopoMap",
    tileUrlTemplate: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    tileAttribution: "© OpenTopoMap © OpenStreetMap contributors",
    maxZoom: 17,
    coordinateSystem: "wgs84",
    subdomains: ["a", "b", "c"],
    tileYMode: "xyz"
  }
];

export function getMapTilePreset(id: MapTilePresetId): MapTilePreset | undefined {
  return MAP_TILE_PRESETS.find((preset) => preset.id === id);
}

export function inferMapTilePresetId(tileUrlTemplate: string): MapTilePresetId {
  return MAP_TILE_PRESETS.find((preset) => preset.tileUrlTemplate === tileUrlTemplate)?.id ?? "custom";
}
