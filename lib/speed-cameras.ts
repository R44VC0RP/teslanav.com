import { getSpeedCameraStats, logAppEvent, replaceSpeedCameras } from "@/lib/db";
import type { SpeedCameraSource, SpeedCameraType } from "@/types/speedcamera";

/**
 * Fixed speed / red-light camera importer.
 *
 * Cameras are bulk-imported into SQLite by an admin-triggered job and served
 * locally by /api/speedcameras, keeping the user-facing runtime free of
 * external calls. Sources (all free, verified July 2026):
 *
 * - OpenStreetMap via a single low-volume Overpass query per import run
 *   (ODbL: the app shows OSM attribution, and this importer is published in
 *   the repository). Base nationwide layer, sparse but broad.
 * - City of Chicago open data (Socrata): authoritative speed + red-light
 *   camera locations for the city's automated enforcement program.
 * - DC open data (ArcGIS): DDOT Automated Safety Cameras, Live/Warning only.
 *
 * City rows win over OSM rows: OSM points of the same type within ~130m of a
 * city point are dropped to avoid double markers.
 */

const USER_AGENT = "TeslaNav-camera-importer/1.0 (https://teslanav.com)";
const FETCH_TIMEOUT_MS = 120_000;
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
// Continental US, Hawaii, Alaska.
const US_BBOXES = [
  "24.4,-125.1,49.5,-66.8",
  "18.5,-160.6,22.5,-154.5",
  "54.5,-170.0,71.5,-129.0",
];
const CHICAGO_SPEED_URL =
  "https://data.cityofchicago.org/resource/4i42-qv3h.json?$limit=2000";
const CHICAGO_RED_LIGHT_URL =
  "https://data.cityofchicago.org/resource/thvf-6diy.json?$limit=2000";
const DC_CAMERAS_URL =
  "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/43/query?" +
  new URLSearchParams({
    where:
      "ENFORCEMENT_TYPE IN ('Red Light','Speed') AND CAMERA_STATUS IN ('Live','Warning')",
    outFields: "OBJECTID,ENFORCEMENT_TYPE,SPEED_LIMIT,LOCATION_DESCRIPTION",
    outSR: "4326",
    resultRecordCount: "2000",
    f: "geojson",
  }).toString();
// City points suppress same-type OSM points within this box (~130m).
const DEDUPE_RADIUS_DEG = 0.0013;

interface ImportedCamera {
  id: string;
  type: SpeedCameraType;
  lat: number;
  lon: number;
  maxspeed?: string;
  direction?: string;
  name?: string;
}

export interface SpeedCameraImportResult {
  sources: Array<{
    source: SpeedCameraSource;
    count: number | null;
    error?: string;
  }>;
  stats: ReturnType<typeof getSpeedCameraStats>;
}

function validCoordinates(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...init?.headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${new URL(url).host} returned ${response.status}`);
  }
  return response.json();
}

async function fetchOsmCameras(): Promise<ImportedCamera[]> {
  // Every clause is a rare-tag index lookup. Do not filter within
  // highway=traffic_signals here: that forces a scan of millions of signal
  // nodes and times out; the bare red_light_camera tag is fast and complete.
  const clauses = US_BBOXES.flatMap((bbox) => [
    `node["highway"="speed_camera"](${bbox});`,
    `node["enforcement"="maxspeed"](${bbox});`,
    `node["enforcement"="average_speed"](${bbox});`,
    `node["red_light_camera"="yes"](${bbox});`,
    `node["enforcement"="traffic_signals"](${bbox});`,
  ]);
  const query = `[out:json][timeout:180];(${clauses.join("")});out body;`;
  const fetchOnce = () =>
    fetchJson(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
  // Overpass rate-limits per IP (429) and sheds load (504); both usually
  // clear within seconds. One spaced retry is enough for a monthly import.
  const data = (await fetchOnce().catch(async (error) => {
    if (!/429|504/.test(error instanceof Error ? error.message : "")) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    return fetchOnce();
  })) as {
    elements?: Array<{
      id: number;
      lat: number;
      lon: number;
      tags?: Record<string, string>;
    }>;
  };

  const cameras: ImportedCamera[] = [];
  const seen = new Set<string>();
  for (const element of data.elements ?? []) {
    if (!validCoordinates(element.lat, element.lon)) continue;
    const id = `osm-${element.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const tags = element.tags ?? {};
    const type: SpeedCameraType =
      tags.enforcement === "average_speed"
        ? "average_speed_camera"
        : tags.red_light_camera === "yes" ||
            tags.enforcement === "traffic_signals"
          ? "red_light_camera"
          : "speed_camera";
    cameras.push({
      id,
      type,
      lat: element.lat,
      lon: element.lon,
      maxspeed: tags.maxspeed,
      direction: tags.direction ?? tags["camera:direction"],
      name: tags.name ?? tags.description,
    });
  }
  return cameras;
}

async function fetchChicagoCameras(): Promise<ImportedCamera[]> {
  const [speedRows, redLightRows] = (await Promise.all([
    fetchJson(CHICAGO_SPEED_URL),
    fetchJson(CHICAGO_RED_LIGHT_URL),
  ])) as [
    Array<{
      address?: string;
      latitude?: string;
      longitude?: string;
      location_id?: string;
    }>,
    Array<{ intersection?: string; latitude?: string; longitude?: string }>,
  ];

  const cameras: ImportedCamera[] = [];
  speedRows.forEach((row, index) => {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (!validCoordinates(lat, lon)) return;
    cameras.push({
      id: `chi-speed-${row.location_id ?? index}`,
      type: "speed_camera",
      lat,
      lon,
      name: row.address,
    });
  });
  redLightRows.forEach((row, index) => {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (!validCoordinates(lat, lon)) return;
    cameras.push({
      id: `chi-rl-${index}`,
      type: "red_light_camera",
      lat,
      lon,
      name: row.intersection,
    });
  });
  return cameras;
}

async function fetchDcCameras(): Promise<ImportedCamera[]> {
  const data = (await fetchJson(DC_CAMERAS_URL)) as {
    features?: Array<{
      geometry?: { type?: string; coordinates?: [number, number] };
      properties?: {
        OBJECTID?: number;
        ENFORCEMENT_TYPE?: string;
        SPEED_LIMIT?: number;
        LOCATION_DESCRIPTION?: string;
      };
    }>;
  };

  const cameras: ImportedCamera[] = [];
  for (const feature of data.features ?? []) {
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    const properties = feature.properties ?? {};
    if (!validCoordinates(lat, lon) || properties.OBJECTID === undefined) {
      continue;
    }
    cameras.push({
      id: `dc-${properties.OBJECTID}`,
      type:
        properties.ENFORCEMENT_TYPE === "Red Light"
          ? "red_light_camera"
          : "speed_camera",
      lat: lat as number,
      lon: lon as number,
      maxspeed: properties.SPEED_LIMIT
        ? String(properties.SPEED_LIMIT)
        : undefined,
      name: properties.LOCATION_DESCRIPTION,
    });
  }
  return cameras;
}

function withoutCityDuplicates(
  osmCameras: ImportedCamera[],
  cityCameras: ImportedCamera[]
): ImportedCamera[] {
  return osmCameras.filter(
    (osm) =>
      !cityCameras.some(
        (city) =>
          city.type === osm.type &&
          Math.abs(city.lat - osm.lat) < DEDUPE_RADIUS_DEG &&
          Math.abs(city.lon - osm.lon) < DEDUPE_RADIUS_DEG
      )
  );
}

/**
 * Fetch every source and swap each one's rows in SQLite. Sources fail
 * independently: an unreachable source keeps its previous rows.
 */
export async function importSpeedCameras(): Promise<SpeedCameraImportResult> {
  const sources: SpeedCameraImportResult["sources"] = [];
  const cityCameras: ImportedCamera[] = [];

  const cityFetches: Array<{
    source: SpeedCameraSource;
    fetcher: () => Promise<ImportedCamera[]>;
  }> = [
    { source: "chicago", fetcher: fetchChicagoCameras },
    { source: "dc", fetcher: fetchDcCameras },
  ];
  for (const { source, fetcher } of cityFetches) {
    try {
      const cameras = await fetcher();
      cityCameras.push(...cameras);
      sources.push({ source, count: replaceSpeedCameras(source, cameras) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sources.push({ source, count: null, error: detail });
    }
  }

  try {
    const osmCameras = withoutCityDuplicates(await fetchOsmCameras(), cityCameras);
    sources.push({ source: "osm", count: replaceSpeedCameras("osm", osmCameras) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sources.push({ source: "osm", count: null, error: detail });
  }

  const failures = sources.filter((entry) => entry.error);
  logAppEvent(
    failures.length > 0 ? "warn" : "info",
    "speed-cameras",
    failures.length > 0
      ? "Speed camera import finished with errors"
      : "Speed cameras imported",
    Object.fromEntries(
      sources.map((entry) => [entry.source, entry.error ?? entry.count])
    )
  );

  return { sources, stats: getSpeedCameraStats() };
}
