import { randomUUID } from "node:crypto";
import {
  deleteWazeRtCredentials,
  getWazeRtCredentials,
  getWazeRtLastRegistration,
  logAppEvent,
  recordWazeRtRegistration,
  storeWazeRtCredentials,
} from "@/lib/db";
import { getRedisClient } from "@/lib/redis";
import { decodeWaze, encodeWaze, WazeTypes } from "@/lib/waze-rt-proto";
import type { MapBounds, WazeAlert } from "@/types/waze";

const PROTOCOL_VERSION = 234;
const APP_VERSION = "5.17.1.0";
const NETWORK_VERSION = "3";
const SESSION_IDLE_MS = 100_000;
const SOFT_TTL_MS = 15_000;
const HARD_TTL_MS = 5 * 60_000;
const SNAPSHOT_TTL_SECONDS = 10 * 60;
const REGISTRATION_COOLDOWN_SECONDS = 10 * 60;
const REFRESH_BUDGET_MS = 12_000;
const TELEPORT_KM = 25;

type Region = "na" | "il" | "row";

interface DeviceIdentity {
  manufacturer: string;
  model: string;
  osVersion: string;
  width: number;
  height: number;
  installationId: string;
}

interface Credentials {
  username: string;
  password: string;
  device: DeviceIdentity;
}

interface SessionInfo {
  id: string;
  secretKey: string;
}

export interface WazeRtSnapshot {
  alerts: WazeAlert[];
  bbox: MapBounds;
  fetchedAt: number;
  source: "waze-rt";
  emptyConfirmed?: boolean;
}

interface DecodedElement {
  old_command?: string;
  error?: { code?: number; description?: string };
  register_successful?: { username?: string; password?: string };
  login_error?: { error_type?: string };
  login_response?: {
    login_success?: {
      server_session_id?: string;
      secret_key?: string;
    };
    login_error?: { error_type?: string };
  };
  add_alert_action?: {
    realtime_alert?: {
      id?: string;
      alert_uuid?: string;
      alert_info?: {
        type?: string;
        sub_type?: string;
        position?: { lon_times1000000?: number; lat_times1000000?: number };
        azymuth?: number;
      };
      alert_reporting_info?: {
        report_time?: string;
        description?: string;
        thumbs_up_count?: number;
        reporter_username?: string;
        alert_address?: { street?: string; city?: string };
      };
    };
  };
}

interface DecodedBatch {
  element?: DecodedElement[];
}

class SessionExpiredError extends Error {}
class AccountRejectedError extends Error {}
class RetryCommandError extends Error {}

const DEVICE_POOL: Omit<DeviceIdentity, "installationId">[] = [
  { manufacturer: "samsung", model: "SM-S928B", osVersion: "16-SDK36", width: 1440, height: 3088 },
  { manufacturer: "Google", model: "Pixel 9 Pro", osVersion: "16-SDK36", width: 1280, height: 2856 },
  { manufacturer: "Google", model: "Pixel 8", osVersion: "15-SDK35", width: 1080, height: 2400 },
  { manufacturer: "OnePlus", model: "CPH2451", osVersion: "15-SDK35", width: 1240, height: 2772 },
];

function randomDevice(): DeviceIdentity {
  const base = DEVICE_POOL[Math.floor(Math.random() * DEVICE_POOL.length)];
  return { ...base, installationId: randomUUID() };
}

function hostFor(region: Region): string {
  if (region === "na") return "https://rt-xlb-am.waze.com";
  if (region === "il") return "https://rt-xlb-il.waze.com";
  return "https://rt-xlb-row.waze.com";
}

export function getWazeRegion(lat: number, lon: number): Region {
  if (lon >= -170 && lon <= -52 && lat >= -15 && lat <= 73) return "na";
  if (lon >= 34 && lon <= 36 && lat >= 29.5 && lat <= 33.5) return "il";
  return "row";
}

function centerOf(bounds: MapBounds): { lat: number; lon: number } {
  return {
    lat: (bounds.north + bounds.south) / 2,
    lon: (bounds.east + bounds.west) / 2,
  };
}

function contains(outer: MapBounds, inner: MapBounds): boolean {
  return (
    inner.west >= outer.west && inner.east <= outer.east &&
    inner.south >= outer.south && inner.north <= outer.north
  );
}

function filterToBounds(alerts: WazeAlert[], bounds: MapBounds): WazeAlert[] {
  return alerts.filter((alert) => {
    const { x, y } = alert.location;
    return x >= bounds.west && x <= bounds.east && y >= bounds.south && y <= bounds.north;
  });
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function expandedBounds(bounds: MapBounds, factor = 1.25): MapBounds {
  const center = centerOf(bounds);
  const halfWidth = ((bounds.east - bounds.west) / 2) * factor;
  const halfHeight = ((bounds.north - bounds.south) / 2) * factor;
  return {
    west: center.lon - halfWidth,
    east: center.lon + halfWidth,
    south: center.lat - halfHeight,
    north: center.lat + halfHeight,
  };
}

function shrinkBounds(bounds: MapBounds, factor: number): MapBounds {
  const center = centerOf(bounds);
  const halfWidth = ((bounds.east - bounds.west) / 2) * factor;
  const halfHeight = ((bounds.north - bounds.south) / 2) * factor;
  return {
    west: center.lon - halfWidth,
    east: center.lon + halfWidth,
    south: center.lat - halfHeight,
    north: center.lat + halfHeight,
  };
}

function mapDisplayed(bounds: MapBounds): string {
  const center = centerOf(bounds);
  const f = (value: number) => value.toFixed(6);
  return [
    "MapDisplayed",
    f(bounds.west), f(bounds.north), f(bounds.east), f(bounds.north),
    f(bounds.east), f(bounds.south), f(bounds.west), f(bounds.south),
    f(center.lon), f(center.lat), "67186",
    f(bounds.west), f(bounds.north), f(bounds.east), f(bounds.north),
    f(bounds.east), f(bounds.south), f(bounds.west), f(bounds.south),
  ].join(",");
}

function protoLine(element: Record<string, unknown>): string {
  const batch = encodeWaze(WazeTypes.Batch, { element: [element] });
  return `ProtoBase64,${Buffer.from(batch).toString("base64")}`;
}

function clientInfoLine(device: DeviceIdentity, lon: number, lat: number): string {
  const lonOffset = ((Math.random() - 0.5) * 1000) / (Math.cos((lat * Math.PI) / 180) * 111320);
  const latOffset = ((Math.random() - 0.5) * 1000) / 110574;
  return protoLine({
    client_info: {
      protocol: PROTOCOL_VERSION,
      client_version: APP_VERSION,
      last_position: {
        lon_times1000000: Math.round((lon + lonOffset) * 1_000_000),
        lat_times1000000: Math.round((lat + latOffset) * 1_000_000),
      },
      manufacturer: device.manufacturer,
      model: device.model,
      os_version: device.osVersion,
      locale: "en",
      installation_id: device.installationId,
      device_type: 50,
      app_type: 1,
      display: [{ type: 2, width: device.width, height: device.height }],
      os_language_id: "en",
      session_uuid: randomUUID(),
      current_time_millis: Date.now(),
      app_flavor: 5,
    },
  });
}

function decodeBatch(bytes: Uint8Array): DecodedBatch {
  return decodeWaze(WazeTypes.Batch, bytes) as unknown as DecodedBatch;
}

function batchErrors(batch: DecodedBatch): Array<{ code: number; description: string }> {
  const errors: Array<{ code: number; description: string }> = [];
  for (const element of batch.element ?? []) {
    if (element.error) {
      errors.push({
        code: element.error.code ?? 0,
        description: element.error.description ?? "",
      });
    }
  }
  return errors;
}

function parseAlert(element: DecodedElement): { uuid: string; alert: WazeAlert } | null {
  const realtime = element.add_alert_action?.realtime_alert;
  const info = realtime?.alert_info;
  const position = info?.position;
  const uuid = realtime?.alert_uuid;
  if (!realtime || !info || !position || !uuid) return null;

  let type = info.type ?? "UNKNOWN";
  if (type === "NEW_BAD_WEATHER" || type === "NEW_LANE_CLOSED" || type === "PERMANENT_HAZARD") {
    type = "HAZARD";
  }
  if (!["POLICE", "ACCIDENT", "HAZARD", "ROAD_CLOSED", "JAM"].includes(type)) return null;

  const reporting = realtime.alert_reporting_info;
  const reportSeconds = Number(reporting?.report_time ?? 0);
  const numericId = realtime.id ?? "0";
  return {
    uuid,
    alert: {
      id: `alert-${numericId}/${uuid}`,
      type: type as WazeAlert["type"],
      subtype: info.sub_type === "NO_SUBTYPE" ? "" : info.sub_type,
      street: reporting?.alert_address?.street,
      city: reporting?.alert_address?.city,
      location: {
        x: (position.lon_times1000000 ?? 0) / 1_000_000,
        y: (position.lat_times1000000 ?? 0) / 1_000_000,
      },
      reportDescription: reporting?.description,
      reliability: 0,
      nThumbsUp: reporting?.thumbs_up_count,
      pubMillis: reportSeconds > 0 ? reportSeconds * 1000 : Date.now(),
      reportBy: reporting?.reporter_username,
      provider: "waze-rt",
      magvar: info.azymuth,
    },
  };
}

class WazeRtSession {
  private credentials: Credentials | null = null;
  private session: SessionInfo | null = null;
  private cookies = new Map<string, string>();
  private sequence = 1;
  private lastRequestAt = 0;
  private generation = 0;

  constructor(private readonly region: Region) {}

  get currentGeneration(): number {
    return this.generation;
  }

  invalidate(): void {
    this.session = null;
  }

  private async post(path: string, body: string, headers: Record<string, string>): Promise<DecodedBatch> {
    const cookie = [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await fetch(`${hostFor(this.region)}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "binary/octet-stream",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookies = getSetCookie ? getSetCookie.call(response.headers) : [];
    for (const value of setCookies) {
      const [pair] = value.split(";", 1);
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }

    if (response.status >= 400 && response.status < 500) {
      if (path.endsWith("/login")) throw new AccountRejectedError(`login HTTP ${response.status}`);
      this.invalidate();
      throw new SessionExpiredError(`command HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`Waze RT HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error("Waze RT returned an empty response");
    return decodeBatch(bytes);
  }

  private async loadCredentials(): Promise<Credentials | null> {
    if (this.credentials) return this.credentials;
    const stored = getWazeRtCredentials(this.region);
    if (!stored) return null;
    try {
      this.credentials = JSON.parse(stored.credentialsJson) as Credentials;
      return this.credentials;
    } catch {
      return null;
    }
  }

  private async register(lon: number, lat: number): Promise<void> {
    const lastRegistration = getWazeRtLastRegistration(this.region);
    if (
      lastRegistration !== null &&
      Date.now() - lastRegistration < REGISTRATION_COOLDOWN_SECONDS * 1000
    ) {
      throw new Error("Waze RT registration cooldown is active");
    }
    // Record the attempt before touching Waze so repeated network/auth failures
    // cannot turn into an account-registration storm.
    recordWazeRtRegistration(this.region);

    const device = randomDevice();
    const body = [clientInfoLine(device, lon, lat), protoLine({ register: {} })].join("\n");
    const batch = await this.post("/rtserver/distrib/static", body, {
      "User-Agent": APP_VERSION,
      "x-waze-network-version": NETWORK_VERSION,
      "sequence-number": String(this.sequence++),
    });
    const success = (batch.element ?? []).find((element) => element.register_successful)?.register_successful;
    if (!success?.username || !success.password) throw new Error("Waze RT registration did not return credentials");
    this.credentials = { username: success.username, password: success.password, device };
    storeWazeRtCredentials(this.region, JSON.stringify(this.credentials));
    console.log(`[WazeRT:${this.region}] registered anonymous read account`);
    logAppEvent("info", "waze-rt", "Registered anonymous read account", {
      region: this.region,
    });
  }

  private async login(lon: number, lat: number): Promise<void> {
    const credentials = (await this.loadCredentials()) ?? null;
    if (!credentials) {
      await this.register(lon, lat);
      return this.login(lon, lat);
    }

    this.cookies.clear();
    const body = [
      clientInfoLine(credentials.device, lon, lat),
      protoLine({
        login_request: {
          password_credential: {
            username: credentials.username,
            password: credentials.password,
          },
          reason: 0,
        },
      }),
      protoLine({ report_ads_setting: {} }),
    ].join("\n");

    let batch: DecodedBatch;
    try {
      batch = await this.post("/rtserver/distrib/login", body, {
        "User-Agent": `waze/${APP_VERSION}`,
        "cache-control": "no-cache",
        "sequence-number": String(this.sequence++),
        "x-waze-network-version": NETWORK_VERSION,
        "x-waze-wait-timeout": "8500",
      });
    } catch (error) {
      if (error instanceof AccountRejectedError) {
        deleteWazeRtCredentials(this.region);
        this.credentials = null;
      }
      throw error;
    }

    const login = (batch.element ?? [])
      .map((element) => element.login_response?.login_success)
      .find(Boolean);
    const loginError = (batch.element ?? [])
      .map((element) => element.login_response?.login_error ?? element.login_error)
      .find(Boolean);
    if (loginError) {
      if (loginError.error_type === "INTERNAL_ISSUES" || loginError.error_type === "UNKNOWN_ERROR") {
        throw new Error(`Waze RT login error: ${loginError.error_type}`);
      }
      deleteWazeRtCredentials(this.region);
      this.credentials = null;
      throw new AccountRejectedError(`Waze RT login rejected: ${loginError.error_type}`);
    }
    if (!login?.server_session_id || !login.secret_key) throw new Error("Waze RT login did not return a session");
    this.session = { id: login.server_session_id, secretKey: login.secret_key };
    this.sequence = 2;
    this.lastRequestAt = Date.now();
    this.generation++;
    console.log(`[WazeRT:${this.region}] login ready`);
  }

  private async ensureReady(lon: number, lat: number): Promise<void> {
    if (!this.session || Date.now() - this.lastRequestAt >= SESSION_IDLE_MS) {
      await this.login(lon, lat);
    }
  }

  private async command(payload: string, retry = true): Promise<DecodedBatch> {
    if (!this.session) throw new SessionExpiredError("command before login");
    const uid = Buffer.from(
      encodeWaze(WazeTypes.UID, { id: this.session.id, secret_key: this.session.secretKey })
    ).toString("base64");
    const batch = await this.post("/rtserver/distrib/command", payload, {
      "User-Agent": APP_VERSION,
      "cache-control": "no-cache",
      "sequence-number": String(this.sequence++),
      "x-waze-network-version": NETWORK_VERSION,
      "x-waze-wait-timeout": "10500",
      uid,
    });
    const errors = batchErrors(batch);
    const retryError = errors.find((error) => error.code === 504 || /retry/i.test(error.description));
    if (retryError) {
      if (retry) return this.command(payload, false);
      throw new RetryCommandError(retryError.description || "Waze RT asked to retry");
    }
    const authError = errors.find((error) => /relogin|unknown userid|secret.?key missing/i.test(error.description));
    if (authError) {
      this.invalidate();
      throw new SessionExpiredError(authError.description);
    }
    const fatal = errors.find((error) => error.code >= 500);
    if (fatal) throw new Error(`Waze RT error ${fatal.code}: ${fatal.description}`);
    this.lastRequestAt = Date.now();
    return batch;
  }

  async prepare(center: { lat: number; lon: number }, bounds: MapBounds): Promise<number> {
    await this.ensureReady(center.lon, center.lat);
    const payload = [
      "SeeMe,1,2,T,T,T,1,-1,1,7",
      "SetMood,1",
      `Location,${center.lon},${center.lat}`,
      mapDisplayed(bounds),
    ].join("\n");
    await this.command(payload);
    return this.generation;
  }

  async query(bounds: MapBounds): Promise<DecodedBatch> {
    return this.command(mapDisplayed(bounds));
  }
}

class WazeRtProvider {
  private readonly session: WazeRtSession;
  private readonly alerts = new Map<string, WazeAlert>();
  private refreshPromise: Promise<void> | null = null;
  private readonly pendingRefreshes = new Map<string, MapBounds>();
  private activeRefreshKey: string | null = null;
  private lastCenter: { lat: number; lon: number } | null = null;
  private appliedGeneration = 0;
  private readonly instanceId = randomUUID();

  constructor(private readonly region: Region) {
    this.session = new WazeRtSession(region);
  }

  snapshotKey(): string {
    return `waze:rt:snapshot:${this.region}`;
  }

  private spatialSnapshotKey(bounds: MapBounds): string {
    const center = centerOf(bounds);
    const latCell = Math.floor((center.lat + 90) * 20);
    const lonCell = Math.floor((center.lon + 180) * 20);
    return `${this.snapshotKey()}:${latCell}:${lonCell}`;
  }

  async getSnapshot(bounds: MapBounds): Promise<WazeRtSnapshot | null> {
    const raws = await getRedisClient().mget(
      this.spatialSnapshotKey(bounds),
      this.snapshotKey()
    );
    const snapshots = raws.flatMap((raw) => {
      if (!raw) return [];
      try {
        return [JSON.parse(raw) as WazeRtSnapshot];
      } catch {
        return [];
      }
    });
    const covering = snapshots
      .filter((snapshot) => contains(snapshot.bbox, bounds))
      .sort((a, b) => b.fetchedAt - a.fetchedAt);
    if (covering[0]) return covering[0];
    return snapshots.sort((a, b) => b.fetchedAt - a.fetchedAt)[0] ?? null;
  }

  private startRefresh(bounds: MapBounds): void {
    this.activeRefreshKey = this.spatialSnapshotKey(bounds);
    this.refreshPromise = this.runRefresh(bounds)
      .catch((error) => {
        console.error(`[WazeRT:${this.region}] refresh failed:`, error);
        logAppEvent("error", "waze-rt", "Alert refresh failed", {
          region: this.region,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.refreshPromise = null;
        this.activeRefreshKey = null;
        const pending = this.pendingRefreshes.entries().next().value as
          | [string, MapBounds]
          | undefined;
        if (pending) {
          this.pendingRefreshes.delete(pending[0]);
          this.startRefresh(pending[1]);
        }
      });
  }

  refresh(bounds: MapBounds): void {
    const expanded = expandedBounds(bounds);
    const refreshKey = this.spatialSnapshotKey(expanded);
    if (this.refreshPromise) {
      // A regional session is serial; retain the newest uncovered request
      // instead of silently dropping it while another location refreshes.
      if (
        refreshKey === this.activeRefreshKey ||
        this.pendingRefreshes.has(refreshKey)
      ) {
        return;
      }
      // Preserve each waiting area instead of allowing the busiest client to
      // overwrite the only pending slot. Bound the queue as a safety valve.
      if (this.pendingRefreshes.size >= 64) {
        const oldest = this.pendingRefreshes.keys().next().value as string | undefined;
        if (oldest) this.pendingRefreshes.delete(oldest);
      }
      this.pendingRefreshes.set(refreshKey, expanded);
      return;
    }
    this.startRefresh(expanded);
  }

  private async runRefresh(bounds: MapBounds): Promise<void> {
    const redis = getRedisClient();
    const lockKey = `waze:rt:refresh-lock:${this.region}:${this.spatialSnapshotKey(bounds)}`;
    // Worst case is a retried handshake plus several 10.5s long-poll commands.
    const lock = await redis.set(lockKey, this.instanceId, "EX", 90, "NX");
    if (lock !== "OK") return;

    try {
      const center = centerOf(bounds);
      if (this.lastCenter && haversineKm(this.lastCenter, center) > TELEPORT_KM) {
        this.alerts.clear();
      }

      let generation: number;
      try {
        generation = await this.session.prepare(center, bounds);
      } catch (error) {
        if (!(error instanceof SessionExpiredError)) throw error;
        this.session.invalidate();
        generation = await this.session.prepare(center, bounds);
      }

      const startedAt = Date.now();
      const boxes = [bounds, shrinkBounds(bounds, 0.5), shrinkBounds(bounds, 0.25)];
      let firstSuccess = true;
      for (const box of boxes) {
        if (Date.now() - startedAt >= REFRESH_BUDGET_MS) break;
        const batch = await this.session.query(box);
        if (firstSuccess && generation !== this.appliedGeneration) {
          this.alerts.clear();
          this.appliedGeneration = generation;
        }
        firstSuccess = false;
        for (const element of batch.element ?? []) {
          if (element.old_command?.startsWith("RmAlert,")) {
            this.alerts.delete(element.old_command.slice("RmAlert,".length).trim());
          }
          const parsed = parseAlert(element);
          if (parsed) this.alerts.set(parsed.uuid, parsed.alert);
        }
      }

      const spatialKey = this.spatialSnapshotKey(bounds);
      const previousRaw = await redis.get(spatialKey);
      let previous: WazeRtSnapshot | null = null;
      if (previousRaw) {
        try {
          previous = JSON.parse(previousRaw) as WazeRtSnapshot;
        } catch {
          previous = null;
        }
      }
      const snapshotAlerts = [...this.alerts.values()];
      const alertsInBounds = filterToBounds(snapshotAlerts, bounds);
      const previousAlertsInBounds = previous
        ? filterToBounds(previous.alerts, bounds)
        : [];
      const snapshot: WazeRtSnapshot = {
        alerts: snapshotAlerts,
        bbox: bounds,
        fetchedAt: Date.now(),
        source: "waze-rt",
        emptyConfirmed:
          alertsInBounds.length === 0 &&
          previousAlertsInBounds.length === 0 &&
          previous !== null &&
          contains(previous.bbox, bounds),
      };
      const serialized = JSON.stringify(snapshot);
      await redis
        .multi()
        .set(spatialKey, serialized, "EX", SNAPSHOT_TTL_SECONDS)
        .set(this.snapshotKey(), serialized, "EX", SNAPSHOT_TTL_SECONDS)
        .exec();
      this.lastCenter = center;
      console.log(`[WazeRT:${this.region}] cached ${snapshot.alerts.length} alerts`);
    } finally {
      // Compare-and-delete atomically so an expired lock reacquired by another
      // process can never be deleted by this refresh's finally block.
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        this.instanceId
      );
    }
  }
}

declare global {
  var __teslanavWazeRtProviders: Map<Region, WazeRtProvider> | undefined;
}

function providerFor(region: Region): WazeRtProvider {
  const providers = globalThis.__teslanavWazeRtProviders ?? new Map<Region, WazeRtProvider>();
  globalThis.__teslanavWazeRtProviders = providers;
  let provider = providers.get(region);
  if (!provider) {
    provider = new WazeRtProvider(region);
    providers.set(region, provider);
  }
  return provider;
}

export async function getWazeRtAlerts(bounds: MapBounds): Promise<{
  alerts: WazeAlert[];
  cache: "HIT" | "STALE" | "MISS";
  ageMs: number | null;
}> {
  const center = centerOf(bounds);
  const provider = providerFor(getWazeRegion(center.lat, center.lon));
  const snapshot = await provider.getSnapshot(bounds);
  const ageMs = snapshot ? Date.now() - snapshot.fetchedAt : null;
  const covers = snapshot ? contains(snapshot.bbox, bounds) : false;
  const filteredAlerts = snapshot ? filterToBounds(snapshot.alerts, bounds) : [];
  const usable = snapshot
    ? filteredAlerts.length > 0 || snapshot.emptyConfirmed === true
    : false;
  const fresh =
    snapshot && covers && usable && ageMs !== null && ageMs < SOFT_TTL_MS;

  if (!fresh) provider.refresh(bounds);

  if (
    !snapshot ||
    !covers ||
    !usable ||
    ageMs === null ||
    ageMs >= HARD_TTL_MS
  ) {
    return { alerts: [], cache: "MISS", ageMs };
  }

  return {
    alerts: filteredAlerts,
    cache: fresh ? "HIT" : "STALE",
    ageMs,
  };
}
