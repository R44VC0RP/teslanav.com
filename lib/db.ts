import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// SQLite database lives on a mounted volume in Docker (./data locally).
const DATABASE_PATH =
  process.env.DATABASE_PATH || path.join(process.cwd(), "data", "teslanav.db");

declare global {
  var __teslanavDb: Database.Database | undefined;
}

function createDatabase(): Database.Database {
  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
  const db = new Database(DATABASE_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      session_token TEXT NOT NULL,
      name TEXT NOT NULL,
      gpx TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_recordings_session ON recordings (session_token);

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id TEXT NOT NULL UNIQUE,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      emailed_at INTEGER,
      email_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_suggestions_created_at ON suggestions (created_at DESC);

    CREATE TABLE IF NOT EXISTS waze_rt_credentials (
      region TEXT PRIMARY KEY,
      credentials_json TEXT NOT NULL,
      registered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS waze_rt_registration (
      region TEXT PRIMARY KEY,
      last_registered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_visitors (
      visitor_hash TEXT PRIMARY KEY,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      total_sessions INTEGER NOT NULL DEFAULT 0,
      total_active_seconds INTEGER NOT NULL DEFAULT 0,
      device_type TEXT NOT NULL DEFAULT 'unknown',
      is_tesla INTEGER NOT NULL DEFAULT 0,
      language TEXT,
      timezone TEXT,
      screen_bucket TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_visitors_last_seen
      ON analytics_visitors (last_seen_at);

    CREATE TABLE IF NOT EXISTS analytics_sessions (
      session_hash TEXT PRIMARY KEY,
      visitor_hash TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      last_heartbeat_at INTEGER NOT NULL,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      pageviews INTEGER NOT NULL DEFAULT 0,
      entry_path TEXT NOT NULL,
      referrer_host TEXT,
      device_type TEXT NOT NULL DEFAULT 'unknown',
      is_tesla INTEGER NOT NULL DEFAULT 0,
      language TEXT,
      timezone TEXT,
      screen_bucket TEXT,
      map_mode TEXT NOT NULL DEFAULT 'standard'
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started
      ON analytics_sessions (started_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_last_seen
      ON analytics_sessions (last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_visitor
      ON analytics_sessions (visitor_hash);

    CREATE TABLE IF NOT EXISTS analytics_daily_visitors (
      day TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      sessions INTEGER NOT NULL DEFAULT 0,
      pageviews INTEGER NOT NULL DEFAULT 0,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, visitor_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_daily_day
      ON analytics_daily_visitors (day);

    CREATE TABLE IF NOT EXISTS analytics_hourly_visitors (
      hour TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      sessions INTEGER NOT NULL DEFAULT 0,
      pageviews INTEGER NOT NULL DEFAULT 0,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour, visitor_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_hourly_hour
      ON analytics_hourly_visitors (hour);

    CREATE TABLE IF NOT EXISTS analytics_pageviews_daily (
      day TEXT NOT NULL,
      path TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, path)
    );

    CREATE TABLE IF NOT EXISTS analytics_pageviews_hourly (
      hour TEXT NOT NULL,
      path TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour, path)
    );

    CREATE TABLE IF NOT EXISTS analytics_events_daily (
      day TEXT NOT NULL,
      event_name TEXT NOT NULL,
      event_value TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, event_name, event_value)
    );

    CREATE TABLE IF NOT EXISTS analytics_events_hourly (
      hour TEXT NOT NULL,
      event_name TEXT NOT NULL,
      event_value TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour, event_name, event_value)
    );

    CREATE TABLE IF NOT EXISTS analytics_requests_hourly (
      hour TEXT NOT NULL,
      route TEXT NOT NULL,
      method TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour, route, method)
    );

    CREATE TABLE IF NOT EXISTS app_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs (created_at DESC);

    CREATE TABLE IF NOT EXISTS analytics_digest_deliveries (
      report_day TEXT NOT NULL,
      recipient TEXT NOT NULL,
      status TEXT NOT NULL,
      attempted_at INTEGER NOT NULL,
      sent_at INTEGER,
      error TEXT,
      PRIMARY KEY (report_day, recipient)
    );
  `);
  return db;
}

/**
 * Lazy singleton: the connection opens on first use, never at module import,
 * so `next build` page-data collection has no filesystem side effects.
 */
export function getDb(): Database.Database {
  if (!globalThis.__teslanavDb) {
    globalThis.__teslanavDb = createDatabase();
  }
  return globalThis.__teslanavDb;
}

export interface RecordingRow {
  id: string;
  session_token: string;
  name: string;
  gpx: string;
  size: number;
  created_at: string;
}

export interface FeedbackRow {
  id: number;
  message: string;
  email: string | null;
  created_at: string;
}

export function insertRecording(recording: {
  id: string;
  sessionToken: string;
  name: string;
  gpx: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO recordings (id, session_token, name, gpx, size) VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      recording.id,
      recording.sessionToken,
      recording.name,
      recording.gpx,
      Buffer.byteLength(recording.gpx, "utf8")
    );
}

export function listRecordings(
  sessionToken: string
): Omit<RecordingRow, "gpx" | "session_token">[] {
  return getDb()
    .prepare(
      `SELECT id, name, size, created_at FROM recordings WHERE session_token = ? ORDER BY created_at DESC`
    )
    .all(sessionToken) as Omit<RecordingRow, "gpx" | "session_token">[];
}

export function getRecording(id: string): RecordingRow | undefined {
  return getDb().prepare(`SELECT * FROM recordings WHERE id = ?`).get(id) as
    | RecordingRow
    | undefined;
}

export function deleteRecording(id: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM recordings WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

export function insertFeedback(message: string, email?: string): number {
  const result = getDb()
    .prepare(`INSERT INTO feedback (message, email) VALUES (?, ?)`)
    .run(message, email ?? null);
  return Number(result.lastInsertRowid);
}

export function listFeedback(limit = 100): FeedbackRow[] {
  return getDb()
    .prepare(`SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as FeedbackRow[];
}

export function getStats(): { recordings: number; feedback: number; suggestions: number } {
  const recordings = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM recordings`)
    .get() as { count: number };
  const feedback = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM feedback`)
    .get() as { count: number };
  const suggestions = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM suggestions`)
    .get() as { count: number };
  return {
    recordings: recordings.count,
    feedback: feedback.count,
    suggestions: suggestions.count,
  };
}

export interface SuggestionRow {
  id: number;
  submissionId: string;
  message: string;
  createdAt: number;
  emailedAt: number | null;
  emailError: string | null;
}

export function getSuggestion(submissionId: string): SuggestionRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, submission_id AS submissionId, message,
              created_at AS createdAt, emailed_at AS emailedAt,
              email_error AS emailError
       FROM suggestions WHERE submission_id = ?`
    )
    .get(submissionId) as SuggestionRow | undefined;
  return row ?? null;
}

export function insertSuggestion(
  submissionId: string,
  message: string
): SuggestionRow {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO suggestions (submission_id, message, created_at)
       VALUES (?, ?, ?)`
    )
    .run(submissionId, message, Date.now());
  const row = getSuggestion(submissionId);
  if (!row) throw new Error("Suggestion insert failed");
  return row;
}

export function markSuggestionEmailed(id: number): void {
  getDb()
    .prepare(
      `UPDATE suggestions SET emailed_at = ?, email_error = NULL WHERE id = ?`
    )
    .run(Date.now(), id);
}

export function markSuggestionEmailFailed(id: number, error: string): void {
  getDb()
    .prepare(`UPDATE suggestions SET email_error = ? WHERE id = ?`)
    .run(error.slice(0, 500), id);
}

export function listSuggestions(limit = 30): SuggestionRow[] {
  return getDb()
    .prepare(
      `SELECT id, submission_id AS submissionId, message,
              created_at AS createdAt, emailed_at AS emailedAt,
              email_error AS emailError
       FROM suggestions ORDER BY created_at DESC LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 100)) as SuggestionRow[];
}

export function getWazeRtCredentials(region: string): {
  credentialsJson: string;
  registeredAt: number;
} | null {
  const row = getDb()
    .prepare(
      `SELECT credentials_json AS credentialsJson, registered_at AS registeredAt
       FROM waze_rt_credentials WHERE region = ?`
    )
    .get(region) as { credentialsJson: string; registeredAt: number } | undefined;
  return row ?? null;
}

export function storeWazeRtCredentials(
  region: string,
  credentialsJson: string,
  registeredAt = Date.now()
): void {
  getDb()
    .prepare(
      `INSERT INTO waze_rt_credentials (region, credentials_json, registered_at)
       VALUES (?, ?, ?)
       ON CONFLICT(region) DO UPDATE SET
         credentials_json = excluded.credentials_json,
         registered_at = excluded.registered_at`
    )
    .run(region, credentialsJson, registeredAt);
}

export function deleteWazeRtCredentials(region: string): void {
  getDb().prepare(`DELETE FROM waze_rt_credentials WHERE region = ?`).run(region);
}

export function getWazeRtLastRegistration(region: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT last_registered_at AS lastRegisteredAt
       FROM waze_rt_registration WHERE region = ?`
    )
    .get(region) as { lastRegisteredAt: number } | undefined;
  return row?.lastRegisteredAt ?? null;
}

export function recordWazeRtRegistration(region: string, at = Date.now()): void {
  getDb()
    .prepare(
      `INSERT INTO waze_rt_registration (region, last_registered_at)
       VALUES (?, ?)
       ON CONFLICT(region) DO UPDATE SET last_registered_at = excluded.last_registered_at`
    )
    .run(region, at);
}

export function listWazeRtCredentialRegions(): string[] {
  const rows = getDb()
    .prepare(`SELECT region FROM waze_rt_credentials ORDER BY region`)
    .all() as Array<{ region: string }>;
  return rows.map((row) => row.region);
}

export interface AnalyticsContext {
  language?: string;
  timezone?: string;
  deviceType: "tesla" | "desktop" | "mobile" | "tablet" | "unknown";
  isTesla: boolean;
  screenBucket?: string;
  referrerHost?: string;
  mapMode: "standard" | "satellite";
}

export interface AnalyticsRecordInput {
  visitorHash: string;
  sessionHash: string;
  type: "session" | "pageview" | "heartbeat" | "event";
  path: string;
  activeSeconds?: number;
  eventName?: string;
  eventValue?: string;
  context: AnalyticsContext;
}

function utcDay(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function utcHour(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 13);
}

function recordAnalyticsRows(input: AnalyticsRecordInput): void {
    const db = getDb();
    const now = Date.now();
    const day = utcDay(now);
    const hour = utcHour(now);
    const existing = db
      .prepare(
        `SELECT last_heartbeat_at AS lastHeartbeatAt
         FROM analytics_sessions WHERE session_hash = ?`
      )
      .get(input.sessionHash) as { lastHeartbeatAt: number } | undefined;
    const isNewSession = !existing;
    const requestedActive = Math.max(
      0,
      Math.min(60, Math.floor(input.activeSeconds ?? 0))
    );
    const allowedActive = existing
      ? Math.max(0, Math.floor((now - existing.lastHeartbeatAt) / 1000) + 5)
      : 0;
    const activeSeconds =
      input.type === "heartbeat"
        ? Math.min(requestedActive, allowedActive)
        : 0;
    const pageviews = input.type === "pageview" ? 1 : 0;

    db.prepare(
      `INSERT INTO analytics_sessions (
        session_hash, visitor_hash, started_at, last_seen_at,
        last_heartbeat_at, active_seconds, pageviews, entry_path,
        referrer_host, device_type, is_tesla, language, timezone,
        screen_bucket, map_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_hash) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        last_heartbeat_at = CASE
          WHEN ? = 'heartbeat' THEN excluded.last_heartbeat_at
          ELSE analytics_sessions.last_heartbeat_at
        END,
        active_seconds = analytics_sessions.active_seconds + excluded.active_seconds,
        pageviews = analytics_sessions.pageviews + excluded.pageviews,
        map_mode = excluded.map_mode`
    ).run(
      input.sessionHash,
      input.visitorHash,
      now,
      now,
      now,
      activeSeconds,
      pageviews,
      input.path,
      input.context.referrerHost ?? null,
      input.context.deviceType,
      input.context.isTesla ? 1 : 0,
      input.context.language ?? null,
      input.context.timezone ?? null,
      input.context.screenBucket ?? null,
      input.context.mapMode,
      input.type
    );

    db.prepare(
      `INSERT INTO analytics_visitors (
        visitor_hash, first_seen_at, last_seen_at, total_sessions,
        total_active_seconds, device_type, is_tesla, language,
        timezone, screen_bucket
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(visitor_hash) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        total_sessions = analytics_visitors.total_sessions + excluded.total_sessions,
        total_active_seconds = analytics_visitors.total_active_seconds + excluded.total_active_seconds,
        device_type = excluded.device_type,
        is_tesla = excluded.is_tesla,
        language = excluded.language,
        timezone = excluded.timezone,
        screen_bucket = excluded.screen_bucket`
    ).run(
      input.visitorHash,
      now,
      now,
      isNewSession ? 1 : 0,
      activeSeconds,
      input.context.deviceType,
      input.context.isTesla ? 1 : 0,
      input.context.language ?? null,
      input.context.timezone ?? null,
      input.context.screenBucket ?? null
    );

    db.prepare(
      `INSERT INTO analytics_daily_visitors (
        day, visitor_hash, sessions, pageviews, active_seconds
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, visitor_hash) DO UPDATE SET
        sessions = analytics_daily_visitors.sessions + excluded.sessions,
        pageviews = analytics_daily_visitors.pageviews + excluded.pageviews,
        active_seconds = analytics_daily_visitors.active_seconds + excluded.active_seconds`
    ).run(day, input.visitorHash, isNewSession ? 1 : 0, pageviews, activeSeconds);

    db.prepare(
      `INSERT INTO analytics_hourly_visitors (
        hour, visitor_hash, sessions, pageviews, active_seconds
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(hour, visitor_hash) DO UPDATE SET
        sessions = analytics_hourly_visitors.sessions + excluded.sessions,
        pageviews = analytics_hourly_visitors.pageviews + excluded.pageviews,
        active_seconds = analytics_hourly_visitors.active_seconds + excluded.active_seconds`
    ).run(hour, input.visitorHash, isNewSession ? 1 : 0, pageviews, activeSeconds);

    if (pageviews) {
      db.prepare(
        `INSERT INTO analytics_pageviews_daily (day, path, count)
         VALUES (?, ?, 1)
         ON CONFLICT(day, path) DO UPDATE SET count = count + 1`
      ).run(day, input.path);
      db.prepare(
        `INSERT INTO analytics_pageviews_hourly (hour, path, count)
         VALUES (?, ?, 1)
         ON CONFLICT(hour, path) DO UPDATE SET count = count + 1`
      ).run(hour, input.path);
    }

    if (input.type === "event" && input.eventName) {
      db.prepare(
        `INSERT INTO analytics_events_daily (day, event_name, event_value, count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(day, event_name, event_value) DO UPDATE SET count = count + 1`
      ).run(day, input.eventName, input.eventValue ?? "");
      db.prepare(
        `INSERT INTO analytics_events_hourly (hour, event_name, event_value, count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(hour, event_name, event_value) DO UPDATE SET count = count + 1`
      ).run(hour, input.eventName, input.eventValue ?? "");
    }
}

export function recordAnalytics(input: AnalyticsRecordInput): void {
  getDb().transaction(recordAnalyticsRows)(input);
  maybePruneAnalytics();
}

let lastAnalyticsPruneAt = 0;

function maybePruneAnalytics(): void {
  const now = Date.now();
  if (now - lastAnalyticsPruneAt < 24 * 60 * 60 * 1000) return;
  lastAnalyticsPruneAt = now;
  const cutoffTimestamp = now - 400 * 86_400_000;
  const cutoffDay = utcDay(cutoffTimestamp);
  const cutoffHour = `${cutoffDay}T00`;
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM analytics_sessions WHERE last_seen_at < ?`).run(cutoffTimestamp);
    db.prepare(`DELETE FROM analytics_visitors WHERE last_seen_at < ?`).run(cutoffTimestamp);
    db.prepare(`DELETE FROM analytics_daily_visitors WHERE day < ?`).run(cutoffDay);
    db.prepare(`DELETE FROM analytics_hourly_visitors WHERE hour < ?`).run(cutoffHour);
    db.prepare(`DELETE FROM analytics_pageviews_daily WHERE day < ?`).run(cutoffDay);
    db.prepare(`DELETE FROM analytics_pageviews_hourly WHERE hour < ?`).run(cutoffHour);
    db.prepare(`DELETE FROM analytics_events_daily WHERE day < ?`).run(cutoffDay);
    db.prepare(`DELETE FROM analytics_events_hourly WHERE hour < ?`).run(cutoffHour);
    db.prepare(`DELETE FROM analytics_requests_hourly WHERE hour < ?`).run(cutoffHour);
  })();
}

export function recordAnalyticsRequest(route: string, method: string): void {
  getDb()
    .prepare(
      `INSERT INTO analytics_requests_hourly (hour, route, method, count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(hour, route, method) DO UPDATE SET count = count + 1`
    )
    .run(utcHour(), route, method);
}

function rangeStart(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export interface AnalyticsStats {
  visitors: {
    activeNow: number;
    today: number;
    sevenDays: number;
    thirtyDays: number;
    newThirtyDays: number;
    returningThirtyDays: number;
  };
  engagement: {
    sessionsToday: number;
    pageviewsToday: number;
    activeSecondsToday: number;
    averageSessionSecondsThirtyDays: number;
  };
  load: {
    requestsCurrentHour: number;
    requestsToday: number;
  };
  daily: Array<{
    day: string;
    visitors: number;
    sessions: number;
    pageviews: number;
    activeSeconds: number;
  }>;
  retention: {
    cohortWindowDays: number;
    rows: Array<{
      dayOffset: number;
      eligibleVisitors: number;
      returningVisitors: number;
      percentage: number | null;
    }>;
  };
  devices: Array<{ value: string; count: number }>;
  topPages: Array<{ value: string; count: number }>;
  topReferrers: Array<{ value: string; count: number }>;
  topEvents: Array<{ name: string; value: string; count: number }>;
  topRequests: Array<{ route: string; method: string; count: number }>;
}

export interface AppLogEntry {
  id: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  detailsJson: string | null;
  createdAt: number;
}

export function logAppEvent(
  level: AppLogEntry["level"],
  source: string,
  message: string,
  details?: Record<string, unknown>
): void {
  getDb()
    .prepare(
      `INSERT INTO app_logs (level, source, message, details_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      level,
      source.slice(0, 64),
      message.slice(0, 500),
      details ? JSON.stringify(details).slice(0, 4000) : null,
      Date.now()
    );

  // Keep a bounded local log history without a maintenance worker.
  getDb()
    .prepare(
      `DELETE FROM app_logs WHERE id NOT IN (
         SELECT id FROM app_logs ORDER BY created_at DESC LIMIT 2000
       )`
    )
    .run();
}

export function listAppLogs(limit = 50): AppLogEntry[] {
  return getDb()
    .prepare(
      `SELECT id, level, source, message,
              details_json AS detailsJson, created_at AS createdAt
       FROM app_logs ORDER BY created_at DESC LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 200)) as AppLogEntry[];
}

export function getAnalyticsStats(): AnalyticsStats {
  const db = getDb();
  const now = Date.now();
  const today = utcDay(now);
  const sevenDays = rangeStart(6);
  const thirtyDays = rangeStart(29);
  const currentHour = utcHour(now);
  const dayRows = db
    .prepare(
      `SELECT day,
              COUNT(*) AS visitors,
              SUM(sessions) AS sessions,
              SUM(pageviews) AS pageviews,
              SUM(active_seconds) AS activeSeconds
       FROM analytics_daily_visitors
       WHERE day >= ?
       GROUP BY day ORDER BY day`
    )
    .all(rangeStart(13)) as Array<{
      day: string;
      visitors: number;
      sessions: number;
      pageviews: number;
      activeSeconds: number;
    }>;
  const byDay = new Map(dayRows.map((row) => [row.day, row]));
  const daily = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (13 - index));
    const day = date.toISOString().slice(0, 10);
    return byDay.get(day) ?? {
      day,
      visitors: 0,
      sessions: 0,
      pageviews: 0,
      activeSeconds: 0,
    };
  });

  const retentionCohortWindowDays = 90;
  const retentionRows = db
    .prepare(
      `WITH RECURSIVE
         offsets(day_offset) AS (
           VALUES (0)
           UNION ALL
           SELECT day_offset + 1 FROM offsets WHERE day_offset < 30
         ),
         cohort AS (
           SELECT visitor_hash,
                  date(first_seen_at / 1000, 'unixepoch') AS first_day
           FROM analytics_visitors
           WHERE date(first_seen_at / 1000, 'unixepoch') >= date(?, '-89 days')
         )
       SELECT o.day_offset AS dayOffset,
              COUNT(c.visitor_hash) AS eligibleVisitors,
              COUNT(d.visitor_hash) AS returningVisitors
       FROM offsets o
       LEFT JOIN cohort c
         ON c.first_day <= date(?, '-' || o.day_offset || ' days')
       LEFT JOIN analytics_daily_visitors d
         ON d.visitor_hash = c.visitor_hash
        AND d.day = date(c.first_day, '+' || o.day_offset || ' days')
       GROUP BY o.day_offset
       ORDER BY o.day_offset`
    )
    .all(today, today) as Array<{
      dayOffset: number;
      eligibleVisitors: number;
      returningVisitors: number;
    }>;

  const scalar = (sql: string, ...params: unknown[]): number => {
    const row = db.prepare(sql).get(...params) as { value: number | null };
    return Number(row?.value ?? 0);
  };

  const dimensions = db
    .prepare(
      `SELECT device_type AS value, COUNT(*) AS count
       FROM analytics_visitors WHERE last_seen_at >= ?
       GROUP BY device_type ORDER BY count DESC`
    )
    .all(now - 30 * 86_400_000) as Array<{ value: string; count: number }>;
  const topPages = db
    .prepare(
      `SELECT path AS value, SUM(count) AS count
       FROM analytics_pageviews_daily WHERE day >= ?
       GROUP BY path ORDER BY count DESC LIMIT 10`
    )
    .all(thirtyDays) as Array<{ value: string; count: number }>;
  const topReferrers = db
    .prepare(
      `SELECT COALESCE(NULLIF(referrer_host, ''), 'Direct') AS value,
              COUNT(*) AS count
       FROM analytics_sessions WHERE started_at >= ?
       GROUP BY value ORDER BY count DESC LIMIT 10`
    )
    .all(now - 30 * 86_400_000) as Array<{ value: string; count: number }>;
  const topEvents = db
    .prepare(
      `SELECT event_name AS name, event_value AS value, SUM(count) AS count
       FROM analytics_events_daily WHERE day >= ?
       GROUP BY event_name, event_value ORDER BY count DESC LIMIT 12`
    )
    .all(thirtyDays) as Array<{ name: string; value: string; count: number }>;
  const topRequests = db
    .prepare(
      `SELECT route, method, SUM(count) AS count
       FROM analytics_requests_hourly WHERE hour >= ?
       GROUP BY route, method ORDER BY count DESC LIMIT 12`
    )
    .all(`${today}T00`) as Array<{ route: string; method: string; count: number }>;

  return {
    visitors: {
      activeNow: scalar(
        `SELECT COUNT(*) AS value FROM analytics_sessions WHERE last_seen_at >= ?`,
        now - 2 * 60_000
      ),
      today: scalar(
        `SELECT COUNT(*) AS value FROM analytics_daily_visitors WHERE day = ?`,
        today
      ),
      sevenDays: scalar(
        `SELECT COUNT(DISTINCT visitor_hash) AS value FROM analytics_daily_visitors WHERE day >= ?`,
        sevenDays
      ),
      thirtyDays: scalar(
        `SELECT COUNT(DISTINCT visitor_hash) AS value FROM analytics_daily_visitors WHERE day >= ?`,
        thirtyDays
      ),
      newThirtyDays: scalar(
        `SELECT COUNT(*) AS value FROM analytics_visitors WHERE first_seen_at >= ?`,
        now - 30 * 86_400_000
      ),
      returningThirtyDays: scalar(
        `SELECT COUNT(*) AS value FROM analytics_visitors
         WHERE last_seen_at >= ? AND total_sessions > 1`,
        now - 30 * 86_400_000
      ),
    },
    engagement: {
      sessionsToday: scalar(
        `SELECT COALESCE(SUM(sessions), 0) AS value
         FROM analytics_daily_visitors WHERE day = ?`,
        today
      ),
      pageviewsToday: scalar(
        `SELECT COALESCE(SUM(pageviews), 0) AS value
         FROM analytics_daily_visitors WHERE day = ?`,
        today
      ),
      activeSecondsToday: scalar(
        `SELECT COALESCE(SUM(active_seconds), 0) AS value
         FROM analytics_daily_visitors WHERE day = ?`,
        today
      ),
      averageSessionSecondsThirtyDays: Math.round(
        scalar(
          `SELECT COALESCE(AVG(active_seconds), 0) AS value
           FROM analytics_sessions WHERE started_at >= ?`,
          now - 30 * 86_400_000
        )
      ),
    },
    load: {
      requestsCurrentHour: scalar(
        `SELECT COALESCE(SUM(count), 0) AS value
         FROM analytics_requests_hourly WHERE hour = ?`,
        currentHour
      ),
      requestsToday: scalar(
        `SELECT COALESCE(SUM(count), 0) AS value
         FROM analytics_requests_hourly WHERE hour >= ?`,
        `${today}T00`
      ),
    },
    daily,
    retention: {
      cohortWindowDays: retentionCohortWindowDays,
      rows: retentionRows.map((row) => ({
        ...row,
        percentage:
          row.eligibleVisitors === 0
            ? null
            : Math.round((row.returningVisitors * 1000) / row.eligibleVisitors) / 10,
      })),
    },
    devices: dimensions,
    topPages,
    topReferrers,
    topEvents,
    topRequests,
  };
}
