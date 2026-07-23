import { createHash } from "node:crypto";
import { getAnalyticsStats, getDb, logAppEvent } from "@/lib/db";

interface Summary {
  visitors: number;
  sessions: number;
  pageviews: number;
  activeSeconds: number;
}

interface RankedValue {
  value: string;
  count: number;
}

export interface AnalyticsDigest {
  reportDay: string;
  timeZone: string;
  dataSource: "hourly" | "utc-fallback";
  summary: Summary;
  previousSummary: Summary;
  newVisitors: number;
  returningVisitors: number;
  teslaVisitors: number;
  requests: number;
  devices: RankedValue[];
  referrers: RankedValue[];
  topPages: RankedValue[];
  topEvents: RankedValue[];
  topRequests: RankedValue[];
  mapModes: RankedValue[];
  dailyTrend: Array<{ day: string; visitors: number }>;
  retention: Array<{
    dayOffset: number;
    eligibleVisitors: number;
    returningVisitors: number;
    percentage: number | null;
  }>;
}

interface TimeZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function timeZoneParts(timestamp: number, timeZone: string): TimeZoneParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

function dayKey(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function shiftDay(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + amount));
  return shifted.toISOString().slice(0, 10);
}

function zonedMidnight(day: string, timeZone: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const target = Date.UTC(year, month - 1, date);
  let result = target;

  // Re-evaluate the offset to handle a DST boundary between adjacent midnights.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = timeZoneParts(result, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute
    );
    const correction = target - actualAsUtc;
    result += correction;
    if (correction === 0) break;
  }
  return result;
}

export function previousDayInTimeZone(
  timeZone: string,
  timestamp = Date.now()
): string {
  const local = timeZoneParts(timestamp, timeZone);
  return shiftDay(dayKey(local.year, local.month, local.day), -1);
}

function reportWindow(day: string, timeZone: string) {
  const start = zonedMidnight(day, timeZone);
  const end = zonedMidnight(shiftDay(day, 1), timeZone);
  return {
    start,
    end,
    startHour: new Date(start).toISOString().slice(0, 13),
    endHour: new Date(end).toISOString().slice(0, 13),
  };
}

function scalar(sql: string, ...params: unknown[]): number {
  const row = getDb().prepare(sql).get(...params) as { value: number | null };
  return Number(row?.value ?? 0);
}

function summaryForDay(day: string, timeZone: string): Summary & { exact: boolean } {
  const window = reportWindow(day, timeZone);
  const firstHourly = getDb()
    .prepare(`SELECT MIN(hour) AS value FROM analytics_hourly_visitors`)
    .get() as { value: string | null };
  const exact = firstHourly.value !== null && firstHourly.value <= window.startHour;

  if (exact) {
    const row = getDb()
      .prepare(
        `SELECT COUNT(DISTINCT visitor_hash) AS visitors,
                COALESCE(SUM(sessions), 0) AS sessions,
                COALESCE(SUM(pageviews), 0) AS pageviews,
                COALESCE(SUM(active_seconds), 0) AS activeSeconds
         FROM analytics_hourly_visitors
         WHERE hour >= ? AND hour < ?`
      )
      .get(window.startHour, window.endHour) as Summary;
    return { ...row, exact: true };
  }

  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS visitors,
              COALESCE(SUM(sessions), 0) AS sessions,
              COALESCE(SUM(pageviews), 0) AS pageviews,
              COALESCE(SUM(active_seconds), 0) AS activeSeconds
       FROM analytics_daily_visitors WHERE day = ?`
    )
    .get(day) as Summary;
  return { ...row, exact: false };
}

function activeVisitorSource(exact: boolean): {
  table: string;
  column: string;
} {
  return exact
    ? { table: "analytics_hourly_visitors", column: "hour" }
    : { table: "analytics_daily_visitors", column: "day" };
}

function ranked(
  sql: string,
  params: unknown[],
  limit = 6
): RankedValue[] {
  return getDb().prepare(sql).all(...params, limit) as RankedValue[];
}

export function buildAnalyticsDigest(
  reportDay: string,
  timeZone: string
): AnalyticsDigest {
  const db = getDb();
  const window = reportWindow(reportDay, timeZone);
  const summary = summaryForDay(reportDay, timeZone);
  const previousSummary = summaryForDay(shiftDay(reportDay, -1), timeZone);
  const source = activeVisitorSource(summary.exact);
  const sourceStart = summary.exact ? window.startHour : reportDay;
  const sourceEnd = summary.exact ? window.endHour : shiftDay(reportDay, 1);
  const activeVisitors = `SELECT DISTINCT visitor_hash FROM ${source.table}
                          WHERE ${source.column} >= ? AND ${source.column} < ?`;
  const pageTable = summary.exact
    ? { name: "analytics_pageviews_hourly", column: "hour" }
    : { name: "analytics_pageviews_daily", column: "day" };
  const eventTable = summary.exact
    ? { name: "analytics_events_hourly", column: "hour" }
    : { name: "analytics_events_daily", column: "day" };

  const devices = ranked(
    `SELECT v.device_type AS value, COUNT(*) AS count
     FROM (${activeVisitors}) active
     JOIN analytics_visitors v ON v.visitor_hash = active.visitor_hash
     GROUP BY v.device_type ORDER BY count DESC LIMIT ?`,
    [sourceStart, sourceEnd]
  );
  const referrers = ranked(
    `SELECT COALESCE(NULLIF(referrer_host, ''), 'Direct') AS value,
            COUNT(*) AS count
     FROM analytics_sessions WHERE started_at >= ? AND started_at < ?
     GROUP BY value ORDER BY count DESC LIMIT ?`,
    [window.start, window.end]
  );
  const topPages = ranked(
    `SELECT path AS value, SUM(count) AS count
     FROM ${pageTable.name}
     WHERE ${pageTable.column} >= ? AND ${pageTable.column} < ?
     GROUP BY path ORDER BY count DESC LIMIT ?`,
    [sourceStart, sourceEnd]
  );
  const topEvents = ranked(
    `SELECT event_name || CASE WHEN event_value = '' THEN '' ELSE ' / ' || event_value END AS value,
            SUM(count) AS count
     FROM ${eventTable.name}
     WHERE ${eventTable.column} >= ? AND ${eventTable.column} < ?
     GROUP BY event_name, event_value ORDER BY count DESC LIMIT ?`,
    [sourceStart, sourceEnd]
  );
  const topRequests = ranked(
    `SELECT method || ' ' || route AS value, SUM(count) AS count
     FROM analytics_requests_hourly WHERE hour >= ? AND hour < ?
     GROUP BY method, route ORDER BY count DESC LIMIT ?`,
    [window.startHour, window.endHour]
  );
  const mapModes = ranked(
    `SELECT map_mode AS value, COUNT(*) AS count
     FROM analytics_sessions WHERE started_at >= ? AND started_at < ?
     GROUP BY map_mode ORDER BY count DESC LIMIT ?`,
    [window.start, window.end],
    3
  );

  const trendStart = shiftDay(reportDay, -13);
  const trendRows = db
    .prepare(
      `SELECT day, COUNT(*) AS visitors
       FROM analytics_daily_visitors
       WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day`
    )
    .all(trendStart, reportDay) as Array<{ day: string; visitors: number }>;
  const trendByDay = new Map(trendRows.map((row) => [row.day, row.visitors]));
  const dailyTrend = Array.from({ length: 14 }, (_, index) => {
    const day = shiftDay(trendStart, index);
    return { day, visitors: trendByDay.get(day) ?? 0 };
  });
  const retention = getAnalyticsStats().retention.rows.filter((row) =>
    [1, 7, 14, 30].includes(row.dayOffset)
  );

  return {
    reportDay,
    timeZone,
    dataSource: summary.exact ? "hourly" : "utc-fallback",
    summary,
    previousSummary,
    newVisitors: scalar(
      `SELECT COUNT(*) AS value FROM analytics_visitors
       WHERE first_seen_at >= ? AND first_seen_at < ?`,
      window.start,
      window.end
    ),
    returningVisitors: scalar(
      `SELECT COUNT(*) AS value FROM (${activeVisitors}) active
       JOIN analytics_visitors v ON v.visitor_hash = active.visitor_hash
       WHERE v.first_seen_at < ?`,
      sourceStart,
      sourceEnd,
      window.start
    ),
    teslaVisitors: scalar(
      `SELECT COUNT(*) AS value FROM (${activeVisitors}) active
       JOIN analytics_visitors v ON v.visitor_hash = active.visitor_hash
       WHERE v.is_tesla = 1`,
      sourceStart,
      sourceEnd
    ),
    requests: scalar(
      `SELECT COALESCE(SUM(count), 0) AS value
       FROM analytics_requests_hourly WHERE hour >= ? AND hour < ?`,
      window.startHour,
      window.endHour
    ),
    devices,
    referrers,
    topPages,
    topEvents,
    topRequests,
    mapModes,
    dailyTrend,
    retention,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function changeLabel(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "No change" : "New activity";
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return "No change";
  return `${change > 0 ? "+" : ""}${change}% vs prior day`;
}

// --- Email presentation ------------------------------------------------
// Light, editorial report layout: typographic hierarchy and hairline rules
// instead of dashboard cards. Email-safe: inline styles, table layout, no
// external assets, scripts, SVG, classes, or remote fonts.

const EMAIL_SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const EMAIL_SERIF = "Georgia,'Times New Roman',Times,serif";
const INK = "#1d1c1a";
const MUTED = "#6d675e";
const FAINT = "#9b9488";
const RULE = "#e6e1d8";
const RULE_STRONG = "#1d1c1a";
const RED = "#c8272c";
const BAR = "#35322c";
const TRACK = "#efebe3";
const PAPER = "#f4f1ec";
const CANVAS = "#ffffff";

function sectionHeading(title: string): string {
  return `<div style="font-family:${EMAIL_SANS};color:${INK};font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;border-bottom:1px solid ${RULE_STRONG};padding-bottom:7px">${escapeHtml(title)}</div>`;
}

function inlineBar(percent: number, color = BAR): string {
  const clamped =
    percent <= 0 ? 0 : Math.max(3, Math.min(100, Math.round(percent)));
  const cells =
    clamped === 0
      ? `<td style="background:${TRACK};height:6px;font-size:1px;line-height:6px">&nbsp;</td>`
      : clamped === 100
        ? `<td style="background:${color};height:6px;font-size:1px;line-height:6px">&nbsp;</td>`
        : `<td width="${clamped}%" style="background:${color};height:6px;font-size:1px;line-height:6px">&nbsp;</td>
           <td style="background:${TRACK};height:6px;font-size:1px;line-height:6px">&nbsp;</td>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed"><tr>${cells}</tr></table>`;
}

function emptyListRow(columns: number): string {
  return `<tr><td colspan="${columns}" style="padding:10px 0 2px;font-family:${EMAIL_SANS};color:${FAINT};font-size:12px;font-style:italic">No activity recorded.</td></tr>`;
}

function heroMetric(
  label: string,
  value: string,
  detail: string,
  side: "left" | "right",
  ruled: boolean
): string {
  const padding = side === "left" ? "16px 10px 18px 0" : "16px 0 18px 10px";
  const border = ruled ? `border-top:1px solid ${RULE};` : "";
  return `<td width="50%" valign="top" style="${border}padding:${padding}">
    <div style="font-family:${EMAIL_SANS};color:${MUTED};font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">${escapeHtml(label)}</div>
    <div style="font-family:${EMAIL_SERIF};color:${INK};font-size:34px;line-height:1.05;margin-top:8px">${escapeHtml(value)}</div>
    <div style="font-family:${EMAIL_SANS};color:${FAINT};font-size:12px;margin-top:7px">${escapeHtml(detail)}</div>
  </td>`;
}

function secondaryMetric(label: string, value: string): string {
  return `<td width="25%" valign="top" style="padding:14px 4px 2px 0">
    <div style="font-family:${EMAIL_SERIF};color:${INK};font-size:19px;line-height:1.1">${escapeHtml(value)}</div>
    <div style="font-family:${EMAIL_SANS};color:${FAINT};font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-top:5px">${escapeHtml(label)}</div>
  </td>`;
}

function rankedSection(title: string, rows: RankedValue[]): string {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const body = rows.length
    ? rows
        .map(
          (row) => `<tr>
            <td style="padding:9px 12px 9px 0;border-bottom:1px solid ${RULE};font-family:${EMAIL_SANS};color:${INK};font-size:13px;line-height:1.4;word-break:break-word">${escapeHtml(row.value)}</td>
            <td width="96" style="padding:9px 0;border-bottom:1px solid ${RULE}">${inlineBar((row.count / max) * 100)}</td>
            <td width="52" align="right" style="padding:9px 0 9px 10px;border-bottom:1px solid ${RULE};font-family:${EMAIL_SANS};color:${MUTED};font-size:12px">${formatNumber(row.count)}</td>
          </tr>`
        )
        .join("")
    : emptyListRow(3);
  return `<div style="margin-top:32px">
    ${sectionHeading(title)}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${body}</table>
  </div>`;
}

function compactList(title: string, rows: RankedValue[]): string {
  const body = rows.length
    ? rows
        .map(
          (row) => `<tr>
            <td style="padding:9px 8px 9px 0;border-bottom:1px solid ${RULE};font-family:${EMAIL_SANS};color:${INK};font-size:13px;line-height:1.4;word-break:break-word">${escapeHtml(row.value)}</td>
            <td align="right" style="padding:9px 0;border-bottom:1px solid ${RULE};font-family:${EMAIL_SANS};color:${MUTED};font-size:12px;white-space:nowrap">${formatNumber(row.count)}</td>
          </tr>`
        )
        .join("")
    : emptyListRow(2);
  return `${sectionHeading(title)}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${body}</table>`;
}

function dailyBars(rows: AnalyticsDigest["dailyTrend"]): string {
  const max = Math.max(1, ...rows.map((row) => row.visitors));
  const last = rows.length - 1;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed">
    <tr>${rows
      .map(
        (row, index) => `<td valign="bottom" align="center" style="padding:0 2px;border-bottom:2px solid ${RULE_STRONG}">
          <div style="font-family:${EMAIL_SANS};font-size:9px;color:${FAINT};margin-bottom:4px">${formatNumber(row.visitors)}</div>
          <div style="height:${Math.max(2, Math.round((row.visitors / max) * 64))}px;background:${index === last ? RED : BAR};font-size:1px;line-height:2px">&nbsp;</div>
        </td>`
      )
      .join("")}</tr>
    <tr>${rows
      .map(
        (row, index) => `<td align="center" style="padding-top:6px;font-family:${EMAIL_SANS};color:${FAINT};font-size:9px">${
          index % 2 === 1 ? escapeHtml(row.day.slice(5)) : ""
        }</td>`
      )
      .join("")}</tr>
  </table>`;
}

function retentionRows(rows: AnalyticsDigest["retention"]): string {
  return rows
    .map((row) => {
      const percentage = row.percentage ?? 0;
      const label =
        row.percentage === null
          ? `<span style="color:${FAINT};font-style:italic">Not eligible yet</span>`
          : `${percentage}% <span style="color:${FAINT}">(${formatNumber(row.returningVisitors)}/${formatNumber(row.eligibleVisitors)})</span>`;
      return `<tr>
        <td width="56" style="padding:9px 12px 9px 0;border-bottom:1px solid ${RULE};font-family:${EMAIL_SANS};color:${MUTED};font-size:12px;font-weight:600;white-space:nowrap">Day ${row.dayOffset}</td>
        <td style="padding:9px 0;border-bottom:1px solid ${RULE}">${inlineBar(percentage)}</td>
        <td width="120" align="right" style="padding:9px 0 9px 12px;border-bottom:1px solid ${RULE};font-family:${EMAIL_SANS};color:${INK};font-size:12px">${label}</td>
      </tr>`;
    })
    .join("");
}

export function renderAnalyticsDigestHtml(digest: AnalyticsDigest, test: boolean): string {
  const reportDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${digest.reportDay}T12:00:00Z`));
  const fallbackNotice =
    digest.dataSource === "utc-fallback"
      ? `<div style="margin-top:20px;padding:2px 0 2px 14px;border-left:3px solid #b08427;font-family:${EMAIL_SANS};color:${MUTED};font-size:12px;line-height:1.6">Historical fallback: hourly Eastern coverage was not available for this date, so visitor, page, and event totals use the existing UTC daily aggregates. Future reports use exact Eastern-day windows.</div>`
      : "";
  const adminUrl = `${process.env.PUBLIC_BASE_URL || "https://teslanav.com"}/admin`;

  return `<!doctype html>
<html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:${PAPER};color:${INK};font-family:${EMAIL_SANS}">
  <div style="display:none;max-height:0;overflow:hidden;color:${PAPER}">${test ? "Test - " : ""}${formatNumber(digest.summary.visitors)} visitors, ${formatNumber(digest.summary.pageviews)} pageviews, and daily retention.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${PAPER}"><tr><td align="center" style="padding:32px 12px 44px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:${CANVAS}">
      <tr><td style="height:3px;background:${RED};font-size:1px;line-height:3px">&nbsp;</td></tr>
      <tr><td style="padding:34px 30px 38px">

        <div style="font-family:${EMAIL_SANS};color:${RED};font-size:12px;font-weight:800;letter-spacing:.22em;text-transform:uppercase">TeslaNav</div>
        <div style="font-family:${EMAIL_SANS};color:${FAINT};font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;margin-top:7px">${test ? "Test &middot; " : ""}Daily analytics report</div>
        <div style="font-family:${EMAIL_SERIF};color:${INK};font-size:30px;line-height:1.15;margin-top:16px">${escapeHtml(reportDate)}</div>
        <div style="font-family:${EMAIL_SANS};color:${MUTED};font-size:12px;margin-top:8px">Previous day &middot; ${escapeHtml(digest.timeZone)}</div>
        ${fallbackNotice}

        <div style="border-top:2px solid ${RULE_STRONG};margin-top:26px"></div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            ${heroMetric("Visitors", formatNumber(digest.summary.visitors), changeLabel(digest.summary.visitors, digest.previousSummary.visitors), "left", false)}
            ${heroMetric("Pageviews", formatNumber(digest.summary.pageviews), changeLabel(digest.summary.pageviews, digest.previousSummary.pageviews), "right", false)}
          </tr>
          <tr>
            ${heroMetric("Sessions", formatNumber(digest.summary.sessions), changeLabel(digest.summary.sessions, digest.previousSummary.sessions), "left", true)}
            ${heroMetric("Engaged time", formatDuration(digest.summary.activeSeconds), changeLabel(digest.summary.activeSeconds, digest.previousSummary.activeSeconds), "right", true)}
          </tr>
        </table>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid ${RULE}">
          <tr>
            ${secondaryMetric("New", formatNumber(digest.newVisitors))}
            ${secondaryMetric("Returning", formatNumber(digest.returningVisitors))}
            ${secondaryMetric("Tesla", formatNumber(digest.teslaVisitors))}
            ${secondaryMetric("Requests", formatNumber(digest.requests))}
          </tr>
        </table>

        <div style="margin-top:36px">
          ${sectionHeading("Last 14 days")}
          <div style="font-family:${EMAIL_SANS};color:${FAINT};font-size:11px;line-height:1.5;margin-top:8px">Unique visitors per day.</div>
          <div style="margin-top:14px">${dailyBars(digest.dailyTrend)}</div>
        </div>

        <div style="margin-top:32px">
          ${sectionHeading("Retention")}
          <div style="font-family:${EMAIL_SANS};color:${FAINT};font-size:11px;line-height:1.5;margin-top:8px">Exact-day cohort return; recent visitors are excluded until eligible.</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:2px">${retentionRows(digest.retention)}</table>
        </div>

        ${rankedSection("Referrers", digest.referrers)}
        ${rankedSection("Top pages", digest.topPages)}

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:32px"><tr>
          <td width="50%" valign="top" style="padding-right:14px">${compactList("Device mix", digest.devices)}</td>
          <td width="50%" valign="top" style="padding-left:14px">${compactList("Map modes", digest.mapModes)}</td>
        </tr></table>

        ${rankedSection("Feature activity", digest.topEvents)}
        ${rankedSection("Top request routes", digest.topRequests)}

        <div style="border-top:1px solid ${RULE};margin-top:38px;padding-top:18px;font-family:${EMAIL_SANS};color:${FAINT};font-size:11px;line-height:1.7;text-align:center">
          Anonymous first-party analytics only. No location, IP address, or page content is included.<br>
          <a href="${escapeHtml(adminUrl)}" style="color:${RED};text-decoration:underline">Open TeslaNav Admin</a>
        </div>

      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export function renderAnalyticsDigestText(digest: AnalyticsDigest, test: boolean): string {
  const lines = [
    `${test ? "TEST - " : ""}TeslaNav Daily Analytics`,
    `${digest.reportDay} (${digest.timeZone})`,
    "",
    `Visitors: ${digest.summary.visitors} (${changeLabel(digest.summary.visitors, digest.previousSummary.visitors)})`,
    `Sessions: ${digest.summary.sessions}`,
    `Pageviews: ${digest.summary.pageviews}`,
    `Engaged time: ${formatDuration(digest.summary.activeSeconds)}`,
    `New visitors: ${digest.newVisitors}`,
    `Returning visitors: ${digest.returningVisitors}`,
    `Tesla visitors: ${digest.teslaVisitors}`,
    `Application requests: ${digest.requests}`,
    "",
    "Retention:",
    ...digest.retention.map(
      (row) =>
        `D${row.dayOffset}: ${row.percentage === null ? "not eligible" : `${row.percentage}% (${row.returningVisitors}/${row.eligibleVisitors})`}`
    ),
    "",
    `Referrers: ${digest.referrers.map((row) => `${row.value} (${row.count})`).join(", ") || "none"}`,
    `Devices: ${digest.devices.map((row) => `${row.value} (${row.count})`).join(", ") || "none"}`,
    `Top pages: ${digest.topPages.map((row) => `${row.value} (${row.count})`).join(", ") || "none"}`,
    `Feature activity: ${digest.topEvents.map((row) => `${row.value} (${row.count})`).join(", ") || "none"}`,
    "",
    digest.dataSource === "utc-fallback"
      ? "Historical fallback: visitor, page, and event totals use UTC daily aggregates."
      : "Data window: exact prior Eastern calendar day.",
  ];
  return lines.join("\n");
}

function reserveDelivery(reportDay: string, recipient: string): "send" | "sent" | "pending" {
  const db = getDb();
  return db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT status, attempted_at AS attemptedAt
         FROM analytics_digest_deliveries WHERE report_day = ? AND recipient = ?`
      )
      .get(reportDay, recipient) as
      | { status: string; attemptedAt: number }
      | undefined;
    if (existing?.status === "sent") return "sent" as const;
    if (existing?.status === "pending" && Date.now() - existing.attemptedAt < 15 * 60_000) {
      return "pending" as const;
    }
    db.prepare(
      `INSERT INTO analytics_digest_deliveries (
         report_day, recipient, status, attempted_at, sent_at, error
       ) VALUES (?, ?, 'pending', ?, NULL, NULL)
       ON CONFLICT(report_day, recipient) DO UPDATE SET
         status = 'pending', attempted_at = excluded.attempted_at,
         sent_at = NULL, error = NULL`
    ).run(reportDay, recipient, Date.now());
    return "send" as const;
  })();
}

function markDelivery(
  reportDay: string,
  recipient: string,
  status: "sent" | "failed",
  error?: string
): void {
  getDb()
    .prepare(
      `UPDATE analytics_digest_deliveries
       SET status = ?, sent_at = ?, error = ?
       WHERE report_day = ? AND recipient = ?`
    )
    .run(
      status,
      status === "sent" ? Date.now() : null,
      error?.slice(0, 500) ?? null,
      reportDay,
      recipient
    );
}

export async function sendAnalyticsDigest(test = false): Promise<{
  sent: boolean;
  duplicate: boolean;
  reportDay: string;
  recipient: string;
  digest: AnalyticsDigest;
}> {
  const apiKey = process.env.INBOUND_API_KEY;
  const recipient = process.env.ANALYTICS_DIGEST_TO?.trim().toLowerCase();
  const timeZone = process.env.ANALYTICS_DIGEST_TIMEZONE || "America/New_York";
  if (!apiKey) throw new Error("INBOUND_API_KEY is not configured");
  if (!recipient) throw new Error("ANALYTICS_DIGEST_TO is not configured");

  const reportDay = previousDayInTimeZone(timeZone);
  const digest = buildAnalyticsDigest(reportDay, timeZone);
  if (!test) {
    const reservation = reserveDelivery(reportDay, recipient);
    if (reservation !== "send") {
      return {
        sent: false,
        duplicate: true,
        reportDay,
        recipient,
        digest,
      };
    }
  }

  const recipientHash = createHash("sha256").update(recipient).digest("hex").slice(0, 12);
  const idempotencyKey = test
    ? `teslanav-digest-test-${reportDay}-${Date.now()}`
    : `teslanav-digest-${reportDay}-${recipientHash}`;
  const response = await fetch("https://inbound.new/api/e2/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: process.env.ANALYTICS_DIGEST_FROM || "TeslaNav Analytics <analytics@teslanav.com>",
      to: [recipient],
      subject: `${test ? "[Test] " : ""}TeslaNav daily analytics - ${reportDay}`,
      html: renderAnalyticsDigestHtml(digest, test),
      text: renderAnalyticsDigestText(digest, test),
      tags: [
        { name: "type", value: "analytics-digest" },
        { name: "report-day", value: reportDay },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    const error = `Inbound returned ${response.status}: ${detail}`;
    if (!test) markDelivery(reportDay, recipient, "failed", error);
    logAppEvent("error", "analytics-digest", "Daily digest delivery failed", {
      reportDay,
      error,
    });
    throw new Error(error);
  }

  if (!test) markDelivery(reportDay, recipient, "sent");
  logAppEvent("info", "analytics-digest", test ? "Test digest emailed" : "Daily digest emailed", {
    reportDay,
  });
  return { sent: true, duplicate: false, reportDay, recipient, digest };
}
