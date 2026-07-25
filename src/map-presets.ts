import { MapTilePresetId } from "./types";

export interface MapTilePreset {
  id: MapTilePresetId;
  name: string;
  tileUrlTemplate: string;
  tileAttribution: string;
  maxZoom: number;
}

export const MAP_TILE_PRESETS: MapTilePreset[] = [
  {
    id: "carto-light",
    name: "CARTO Light",
    tileUrlTemplate: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    tileAttribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20
  },
  {
    id: "carto-voyager",
    name: "CARTO Voyager",
    tileUrlTemplate: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    tileAttribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20
  },
  {
    id: "carto-dark",
    name: "CARTO Dark",
    tileUrlTemplate: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    tileAttribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20
  },
  {
    id: "osm-standard",
    name: "OpenStreetMap Standard",
    tileUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileAttribution: "© OpenStreetMap contributors",
    maxZoom: 19
  },
  {
    id: "opentopomap",
    name: "OpenTopoMap",
    tileUrlTemplate: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    tileAttribution: "© OpenTopoMap © OpenStreetMap contributors",
    maxZoom: 17
  }
];

export function getMapTilePreset(id: MapTilePresetId): MapTilePreset | undefined {
  return MAP_TILE_PRESETS.find((preset) => preset.id === id);
}

export function inferMapTilePresetId(tileUrlTemplate: string): MapTilePresetId {
  return MAP_TILE_PRESETS.find((preset) => preset.tileUrlTemplate === tileUrlTemplate)?.id ?? "custom";
}
