export type OpenFreeMapStyle =
  | "positron"
  | "bright"
  | "liberty"
  | "dark"
  | "fiord"
  | "satellite-esri"
  | "satellite-usgs";

interface MapStyleDefinition {
  label: string;
  url: string;
  satelliteTilesUrl?: string;
  satelliteAttribution?: string;
  maxZoom?: number;
}

export const OPENFREEMAP_STYLES: Record<OpenFreeMapStyle, MapStyleDefinition> = {
  positron: {
    label: "Positron",
    url: "https://tiles.openfreemap.org/styles/positron",
  },
  bright: {
    label: "Bright",
    url: "https://tiles.openfreemap.org/styles/bright",
  },
  liberty: {
    label: "Liberty",
    url: "https://tiles.openfreemap.org/styles/liberty",
  },
  dark: {
    label: "Dark",
    url: "https://tiles.openfreemap.org/styles/dark",
  },
  fiord: {
    label: "Fiord",
    url: "https://tiles.openfreemap.org/styles/fiord",
  },
  "satellite-esri": {
    label: "Satellite · Esri",
    url: "https://tiles.openfreemap.org/styles/liberty",
    satelliteTilesUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    satelliteAttribution:
      "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
  "satellite-usgs": {
    label: "Satellite · USGS",
    url: "https://tiles.openfreemap.org/styles/liberty",
    satelliteTilesUrl:
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    satelliteAttribution: "USDA, USGS The National Map: Orthoimagery",
    maxZoom: 16,
  },
};

export const DEFAULT_MAP_STYLE: OpenFreeMapStyle = "liberty";

export function isOpenFreeMapStyle(value: string | null): value is OpenFreeMapStyle {
  return value !== null && value in OPENFREEMAP_STYLES;
}
