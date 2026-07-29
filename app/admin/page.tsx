"use client";

import { useState, useCallback } from "react";

interface FeedbackEntry {
  id: number;
  message: string;
  email: string | null;
  created_at: string;
}

interface UsageData {
  sqlite: {
    recordings: number;
    feedback: number;
    suggestions: number;
  };
  redis: {
    ok: boolean;
    cachedKeys: number;
  };
  wazeRt: Array<{
    region: string;
    credentialsReady: boolean;
    snapshotAgeMs: number | null;
    alertCount: number;
  }>;
  analytics: {
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
    hourly: Array<{ hour: string; visitors: number; pageviews: number }>;
    requestsByHour: Array<{ hour: string; count: number }>;
    channels: Array<{ value: string; count: number }>;
    countries: Array<{ value: string; count: number }>;
    retention: {
      cohortWindowDays: number;
      startedAt: string;
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
  };
  system: {
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
  };
  recentLogs: Array<{
    id: number;
    level: "info" | "warn" | "error";
    source: string;
    message: string;
    detailsJson: string | null;
    createdAt: number;
  }>;
  recentSuggestions: Array<{
    id: number;
    submissionId: string;
    message: string;
    createdAt: number;
    emailedAt: number | null;
    emailError: string | null;
  }>;
  recentFeedback: FeedbackEntry[];
  recentUserReports: Array<{
    id: string;
    type: string;
    lat: number;
    lon: number;
    createdAt: number;
    expiresAt: number;
    confirmations: number;
    deletedAt: number | null;
  }>;
}

const REPORT_TYPE_BADGES: Record<string, string> = {
  POLICE: "bg-blue-500/15 text-blue-300",
  ACCIDENT: "bg-red-500/15 text-red-300",
  HAZARD: "bg-amber-500/15 text-amber-300",
  ROAD_CLOSED: "bg-gray-500/15 text-gray-300",
  JAM: "bg-violet-500/15 text-violet-300",
};

export default function AdminPage() {
  const [apiKey, setApiKey] = useState("");
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/usage", {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${response.status})`);
      }

      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  const deleteReport = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(
          `/api/admin/reports?id=${encodeURIComponent(id)}`,
          {
            method: "DELETE",
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          }
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Delete failed (${response.status})`);
        }
        await fetchUsage();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    },
    [apiKey, fetchUsage]
  );

  return (
    <main className="h-full bg-neutral-950 text-white p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold">TeslaNav Admin</h1>
          <p className="text-neutral-400 mt-1">Self-contained instance stats</p>
        </div>

        {/* Auth + fetch */}
        <div className="flex gap-3">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Admin API key (if configured)"
            className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
            onKeyDown={(e) => e.key === "Enter" && fetchUsage()}
          />
          <button
            onClick={fetchUsage}
            disabled={loading}
            className="px-6 py-2.5 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load stats"}
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300">
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Recordings" value={data.sqlite.recordings} />
              <StatCard label="Feedback messages" value={data.sqlite.feedback} />
              <StatCard label="Suggestions" value={data.sqlite.suggestions} />
              <StatCard
                label="Redis cached keys"
                value={data.redis.ok ? data.redis.cachedKeys : "down"}
              />
            </div>

            {/* Audience */}
            <div>
              <div className="flex items-end justify-between gap-4 mb-3">
                <div>
                  <h2 className="text-xl font-semibold">Audience</h2>
                  <p className="text-sm text-neutral-500">Anonymous first-party visitor IDs</p>
                </div>
                <div className="text-xs text-neutral-500 tabular-nums">
                  Uptime {formatDuration(data.system.uptimeSeconds)} · RSS {formatBytes(data.system.rssBytes)}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                <StatCard label="Active now" value={data.analytics.visitors.activeNow} />
                <StatCard label="Today" value={data.analytics.visitors.today} />
                <StatCard label="7-day users" value={data.analytics.visitors.sevenDays} />
                <StatCard label="30-day users" value={data.analytics.visitors.thirtyDays} />
                <StatCard label="New · 30d" value={data.analytics.visitors.newThirtyDays} />
                <StatCard label="Returning · 30d" value={data.analytics.visitors.returningThirtyDays} />
              </div>
            </div>

            {/* Hourly pulse: today vs yesterday */}
            <section className="p-5 rounded-xl bg-white/5 border border-white/10">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-xl font-semibold">Right now</h2>
                  <p className="text-sm text-neutral-500 mt-1">
                    Unique visitors each hour · today vs yesterday · UTC
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs text-neutral-400">
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-4 border-t-2 border-blue-400" />
                    Today
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-4 border-t-2 border-dashed border-neutral-500" />
                    Yesterday
                  </span>
                </div>
              </div>
              <HourlyPulseChart slots={data.analytics.hourly} />
            </section>

            {/* Daily trend */}
            <section className="p-5 rounded-xl bg-white/5 border border-white/10">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-xl font-semibold">Daily trend</h2>
                  <p className="text-sm text-neutral-500 mt-1">
                    Since {data.analytics.daily[0]?.day ?? "—"} · UTC
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs text-neutral-400">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-sm bg-blue-500/80" />
                    Visitors
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-4 border-t-2 border-violet-400" />
                    Sessions
                  </span>
                </div>
              </div>
              <DailyTrendChart rows={data.analytics.daily} />
            </section>

            {/* Engagement and load */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="p-5 rounded-xl bg-white/5 border border-white/10">
                <h2 className="text-xl font-semibold">Engagement</h2>
                <p className="text-sm text-neutral-500 mt-1 mb-4">
                  Average session length by day
                </p>
                <div className="flex flex-wrap gap-x-8 gap-y-2 mb-5">
                  <MiniStat label="Sessions today" value={data.analytics.engagement.sessionsToday} />
                  <MiniStat label="Pageviews today" value={data.analytics.engagement.pageviewsToday} />
                  <MiniStat
                    label="Engaged time today"
                    value={formatDuration(data.analytics.engagement.activeSecondsToday)}
                  />
                  <MiniStat
                    label="Avg session · 30d"
                    value={formatDuration(data.analytics.engagement.averageSessionSecondsThirtyDays)}
                  />
                </div>
                <EngagementBars rows={data.analytics.daily} />
              </section>
              <section className="p-5 rounded-xl bg-white/5 border border-white/10">
                <h2 className="text-xl font-semibold">Application load</h2>
                <p className="text-sm text-neutral-500 mt-1 mb-4">
                  API requests per hour · last 24h
                </p>
                <div className="flex flex-wrap gap-x-8 gap-y-2 mb-5">
                  <MiniStat label="This hour" value={data.analytics.load.requestsCurrentHour} />
                  <MiniStat label="Today" value={data.analytics.load.requestsToday} />
                  <MiniStat
                    label="Redis keys"
                    value={data.redis.ok ? data.redis.cachedKeys : "down"}
                  />
                  <MiniStat label="Heap" value={formatBytes(data.system.heapUsedBytes)} />
                </div>
                <RequestsAreaChart slots={data.analytics.requestsByHour} />
              </section>
            </div>

            {/* Retention */}
            <section className="p-5 rounded-xl bg-white/5 border border-white/10">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-xl font-semibold">Visitor retention</h2>
                  <p className="text-sm text-neutral-500 mt-1">
                    Exact UTC-day return · since {data.analytics.retention.startedAt}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <span className="size-2 rounded-full bg-blue-400" />
                  Percent returning
                </div>
              </div>
              <RetentionChart rows={data.analytics.retention.rows} />
            </section>

            {/* Acquisition */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="p-5 rounded-xl bg-white/5 border border-white/10">
                <h2 className="text-xl font-semibold">Channels · 30d</h2>
                <p className="text-sm text-neutral-500 mt-1 mb-5">
                  Sessions grouped by referrer
                </p>
                <BreakdownBars rows={data.analytics.channels} color="#60a5fa" />
              </section>
              <section className="p-5 rounded-xl bg-white/5 border border-white/10">
                <h2 className="text-xl font-semibold">Countries · 30d</h2>
                <p className="text-sm text-neutral-500 mt-1 mb-5">
                  Unique visitors by timezone-derived country
                </p>
                <BreakdownBars
                  rows={data.analytics.countries.map((row) => {
                    const { flag, name } = countryDisplay(row.value);
                    return { value: `${flag} ${name}`, count: row.count };
                  })}
                  color="#34d399"
                />
              </section>
            </div>

            {/* Analytics breakdowns */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              <RankList title="Device mix · 30d" rows={data.analytics.devices} />
              <RankList title="Top pages · 30d" rows={data.analytics.topPages} />
              <RankList title="Referrers · 30d" rows={data.analytics.topReferrers} />
              <RankList
                title="Feature events · 30d"
                rows={data.analytics.topEvents.map((event) => ({
                  value: `${event.name}${event.value ? ` · ${event.value}` : ""}`,
                  count: event.count,
                }))}
              />
              <RankList
                title="Request routes · today"
                rows={data.analytics.topRequests.map((request) => ({
                  value: `${request.method} ${request.route}`,
                  count: request.count,
                }))}
              />
            </div>

            {/* Waze RT health */}
            <div>
              <h2 className="text-xl font-semibold mb-3">Waze RT</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {data.wazeRt.map((status) => (
                  <div
                    key={status.region}
                    className="p-5 rounded-xl bg-white/5 border border-white/10"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold uppercase">{status.region}</span>
                      <span
                        className={status.credentialsReady ? "text-green-400" : "text-neutral-500"}
                      >
                        {status.credentialsReady ? "ready" : "unused"}
                      </span>
                    </div>
                    <div className="text-2xl font-bold mt-3">{status.alertCount}</div>
                    <div className="text-xs text-neutral-400 mt-1">
                      {status.snapshotAgeMs === null
                        ? "No snapshot"
                        : `${Math.round(status.snapshotAgeMs / 1000)}s old`}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Suggestions */}
            <div>
              <h2 className="text-xl font-semibold mb-3">Recent suggestions</h2>
              {data.recentSuggestions.length === 0 ? (
                <p className="text-neutral-500">No suggestions yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.recentSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="p-4 rounded-xl bg-white/5 border border-white/10"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm whitespace-pre-wrap text-pretty">
                          {suggestion.message}
                        </p>
                        <span
                          className={`flex-shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                            suggestion.emailedAt
                              ? "bg-green-500/15 text-green-300"
                              : "bg-red-500/15 text-red-300"
                          }`}
                        >
                          {suggestion.emailedAt ? "emailed" : "failed"}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 mt-2 tabular-nums">
                        #{suggestion.id} · {new Date(suggestion.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* User reports */}
            <div>
              <h2 className="text-xl font-semibold mb-3">Recent user reports</h2>
              {data.recentUserReports.length === 0 ? (
                <p className="text-neutral-500">No user reports yet.</p>
              ) : (
                <div className="rounded-xl bg-white/5 border border-white/10 divide-y divide-white/5 overflow-hidden">
                  {data.recentUserReports.map((report) => {
                    const status = report.deletedAt
                      ? "deleted"
                      : report.expiresAt > Date.now()
                        ? "active"
                        : "expired";
                    return (
                      <div
                        key={report.id}
                        className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-3 text-sm"
                      >
                        <span
                          className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                            REPORT_TYPE_BADGES[report.type] ?? "bg-white/10 text-neutral-300"
                          }`}
                        >
                          {report.type.replace(/_/g, " ")}
                        </span>
                        <span className="min-w-0 truncate text-neutral-400 tabular-nums">
                          {report.lat.toFixed(5)}, {report.lon.toFixed(5)}
                          {report.confirmations > 0 ? ` · ${report.confirmations}× confirmed` : ""}
                        </span>
                        <span
                          className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                            status === "active"
                              ? "bg-green-500/15 text-green-300"
                              : status === "deleted"
                                ? "bg-red-500/15 text-red-300"
                                : "bg-white/10 text-neutral-400"
                          }`}
                        >
                          {status}
                        </span>
                        <time className="text-xs text-neutral-500 tabular-nums whitespace-nowrap">
                          {new Date(report.createdAt).toLocaleString()}
                        </time>
                        {status === "active" ? (
                          <button
                            onClick={() => deleteReport(report.id)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium bg-red-500/10 text-red-300 hover:bg-red-500/25 transition-colors"
                          >
                            Delete
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Operational logs */}
            <div>
              <h2 className="text-xl font-semibold mb-3">Recent operational logs</h2>
              {data.recentLogs.length === 0 ? (
                <p className="text-neutral-500">No warnings or operational events yet.</p>
              ) : (
                <div className="rounded-xl bg-white/5 border border-white/10 divide-y divide-white/5 overflow-hidden">
                  {data.recentLogs.map((entry) => (
                    <div key={entry.id} className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 px-4 py-3 text-sm">
                      <span
                        className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          entry.level === "error"
                            ? "bg-red-500/15 text-red-300"
                            : entry.level === "warn"
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-blue-500/15 text-blue-300"
                        }`}
                      >
                        {entry.level}
                      </span>
                      <span className="text-neutral-400 font-medium">{entry.source}</span>
                      <span className="min-w-0 truncate" title={entry.detailsJson || entry.message}>
                        {entry.message}
                      </span>
                      <time className="text-xs text-neutral-500 tabular-nums whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString()}
                      </time>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent feedback */}
            <div>
              <h2 className="text-xl font-semibold mb-3">Recent feedback</h2>
              {data.recentFeedback.length === 0 ? (
                <p className="text-neutral-500">No feedback yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.recentFeedback.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-4 rounded-xl bg-white/5 border border-white/10"
                    >
                      <p className="text-sm whitespace-pre-wrap">{entry.message}</p>
                      <p className="text-xs text-neutral-500 mt-2">
                        {entry.email || "anonymous"} · {entry.created_at}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-5 rounded-xl bg-white/5 border border-white/10">
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm text-neutral-400 mt-1">{label}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-xl font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
    </div>
  );
}

function countryDisplay(code: string): { flag: string; name: string } {
  if (/^[A-Z]{2}$/.test(code)) {
    const flag = String.fromCodePoint(
      ...[...code].map((character) => 0x1f1e6 + character.charCodeAt(0) - 65)
    );
    let name = code;
    try {
      name = new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
    } catch {
      // Older browsers: fall back to the raw code.
    }
    return { flag, name };
  }
  return { flag: "🌐", name: code };
}

function HourlyPulseChart({
  slots,
}: {
  slots: UsageData["analytics"]["hourly"];
}) {
  const width = 900;
  const height = 220;
  const margin = { top: 14, right: 18, bottom: 30, left: 40 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const yesterday = slots.slice(0, 24);
  const today = slots.slice(24, 48);
  const currentHourIndex = new Date().getUTCHours();
  const todayPlotted = today.slice(0, currentHourIndex + 1);
  const max = Math.max(
    1,
    ...yesterday.map((slot) => slot.visitors),
    ...today.map((slot) => slot.visitors)
  );
  const x = (index: number) => margin.left + (index / 23) * plotWidth;
  const y = (value: number) => margin.top + (1 - value / max) * plotHeight;

  const toLine = (points: Array<{ visitors: number }>) =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.visitors)}`
      )
      .join(" ");
  const todayLine = toLine(todayPlotted);
  const todayArea = todayPlotted.length
    ? `${todayLine} L ${x(todayPlotted.length - 1)} ${margin.top + plotHeight} L ${x(0)} ${margin.top + plotHeight} Z`
    : "";

  const gridSteps = 4;
  const currentSlot = todayPlotted.at(-1);
  const yesterdaySameHour = yesterday[currentHourIndex]?.visitors ?? 0;

  return (
    <div>
      <div className="mb-4 text-sm text-neutral-400">
        This hour:{" "}
        <span className="font-semibold text-white tabular-nums">
          {currentSlot?.visitors ?? 0}
        </span>{" "}
        visitors · same hour yesterday:{" "}
        <span className="font-semibold text-neutral-300 tabular-nums">
          {yesterdaySameHour}
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[720px] w-full h-auto"
          role="img"
          aria-label="Unique visitors per hour, today compared with yesterday"
        >
          <defs>
            <linearGradient id="pulse-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {Array.from({ length: gridSteps + 1 }, (_, step) => {
            const value = Math.round((max / gridSteps) * step);
            return (
              <g key={step}>
                <line
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="rgba(255,255,255,0.07)"
                />
                <text
                  x={margin.left - 8}
                  y={y(value) + 4}
                  textAnchor="end"
                  fill="#737373"
                  fontSize="10"
                >
                  {value}
                </text>
              </g>
            );
          })}

          {[0, 4, 8, 12, 16, 20, 23].map((hour) => (
            <text
              key={hour}
              x={x(hour)}
              y={height - 8}
              textAnchor="middle"
              fill="#737373"
              fontSize="10"
            >
              {String(hour).padStart(2, "0")}:00
            </text>
          ))}

          <path
            d={toLine(yesterday)}
            fill="none"
            stroke="#737373"
            strokeWidth="2"
            strokeDasharray="5 5"
            strokeLinecap="round"
          />
          {todayArea && <path d={todayArea} fill="url(#pulse-area)" />}
          {todayLine && (
            <path
              d={todayLine}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {currentSlot && (
            <circle
              cx={x(todayPlotted.length - 1)}
              cy={y(currentSlot.visitors)}
              r="5"
              fill="#93c5fd"
              stroke="#171717"
              strokeWidth="2"
            />
          )}

          {slots.map((slot, index) =>
            index < 24 ? (
              <rect
                key={slot.hour}
                x={x(index) - plotWidth / 46}
                y={margin.top}
                width={plotWidth / 23}
                height={plotHeight}
                fill="transparent"
              >
                <title>{`${slot.hour}:00 yesterday · ${slot.visitors} visitors`}</title>
              </rect>
            ) : null
          )}
        </svg>
      </div>
    </div>
  );
}

function DailyTrendChart({ rows }: { rows: UsageData["analytics"]["daily"] }) {
  const width = 900;
  const height = 280;
  const margin = { top: 22, right: 18, bottom: 34, left: 40 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const count = Math.max(1, rows.length);
  const max = Math.max(
    1,
    ...rows.map((row) => Math.max(row.visitors, row.sessions))
  );
  const slotWidth = plotWidth / count;
  const barWidth = Math.min(56, slotWidth * 0.55);
  const xCenter = (index: number) => margin.left + slotWidth * (index + 0.5);
  const y = (value: number) => margin.top + (1 - value / max) * plotHeight;
  const labelStep = Math.ceil(count / 16);

  const sessionsLine = rows
    .map(
      (row, index) =>
        `${index === 0 ? "M" : "L"} ${xCenter(index)} ${y(row.sessions)}`
    )
    .join(" ");

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[720px] w-full h-auto"
        role="img"
        aria-label="Daily visitors and sessions"
      >
        <defs>
          <linearGradient id="trend-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.45" />
          </linearGradient>
        </defs>

        {Array.from({ length: 5 }, (_, step) => {
          const value = Math.round((max / 4) * step);
          return (
            <g key={step}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y(value)}
                y2={y(value)}
                stroke="rgba(255,255,255,0.07)"
              />
              <text
                x={margin.left - 8}
                y={y(value) + 4}
                textAnchor="end"
                fill="#737373"
                fontSize="10"
              >
                {value}
              </text>
            </g>
          );
        })}

        {rows.map((row, index) => (
          <g key={row.day}>
            <rect
              x={xCenter(index) - barWidth / 2}
              y={y(row.visitors)}
              width={barWidth}
              height={Math.max(2, margin.top + plotHeight - y(row.visitors))}
              rx="6"
              fill="url(#trend-bar)"
            >
              <title>
                {`${row.day} · ${row.visitors} visitors · ${row.sessions} sessions · ${row.pageviews} pageviews · ${formatDuration(row.activeSeconds)} engaged`}
              </title>
            </rect>
            <text
              x={xCenter(index)}
              y={y(row.visitors) - 7}
              textAnchor="middle"
              fill="#d4d4d4"
              fontSize="11"
              fontWeight="600"
            >
              {row.visitors}
            </text>
            {index % labelStep === 0 && (
              <text
                x={xCenter(index)}
                y={height - 10}
                textAnchor="middle"
                fill="#737373"
                fontSize="10"
              >
                {row.day.slice(5)}
              </text>
            )}
          </g>
        ))}

        <path
          d={sessionsLine}
          fill="none"
          stroke="#a78bfa"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {rows.map((row, index) => (
          <circle
            key={row.day}
            cx={xCenter(index)}
            cy={y(row.sessions)}
            r="3"
            fill="#c4b5fd"
            stroke="#171717"
            strokeWidth="1.5"
          />
        ))}
      </svg>
    </div>
  );
}

function EngagementBars({ rows }: { rows: UsageData["analytics"]["daily"] }) {
  const points = rows.map((row) => ({
    day: row.day,
    minutes:
      row.sessions > 0 ? Math.round(row.activeSeconds / row.sessions / 6) / 10 : 0,
  }));
  const max = Math.max(1, ...points.map((point) => point.minutes));
  return (
    <div className="flex items-end gap-2 h-36">
      {points.map((point) => (
        <div
          key={point.day}
          className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1.5"
        >
          <span className="text-[11px] text-neutral-400 tabular-nums">
            {point.minutes}m
          </span>
          <div
            className="w-full max-w-12 rounded-md bg-amber-400/70 min-h-[2px]"
            style={{ height: `${(point.minutes / max) * 78}%` }}
            title={`${point.day} · avg session ${point.minutes} minutes`}
          />
          <span className="text-[10px] text-neutral-500 tabular-nums">
            {point.day.slice(5)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RequestsAreaChart({
  slots,
}: {
  slots: UsageData["analytics"]["requestsByHour"];
}) {
  const width = 420;
  const height = 150;
  const margin = { top: 8, right: 6, bottom: 20, left: 6 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const max = Math.max(1, ...slots.map((slot) => slot.count));
  const x = (index: number) =>
    margin.left + (index / Math.max(1, slots.length - 1)) * plotWidth;
  const y = (value: number) => margin.top + (1 - value / max) * plotHeight;
  const line = slots
    .map(
      (slot, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(slot.count)}`
    )
    .join(" ");
  const area = `${line} L ${x(slots.length - 1)} ${margin.top + plotHeight} L ${x(0)} ${margin.top + plotHeight} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label="API requests per hour over the last 24 hours"
    >
      <defs>
        <linearGradient id="requests-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#requests-area)" />
      <path
        d={line}
        fill="none"
        stroke="#34d399"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {slots.map((slot, index) => (
        <rect
          key={slot.hour}
          x={x(index) - plotWidth / slots.length / 2}
          y={margin.top}
          width={plotWidth / slots.length}
          height={plotHeight}
          fill="transparent"
        >
          <title>{`${slot.hour.slice(11)}:00 UTC · ${slot.count} requests`}</title>
        </rect>
      ))}
      <text x={x(0)} y={height - 6} fill="#737373" fontSize="10">
        {slots[0]?.hour.slice(11)}:00
      </text>
      <text
        x={x(slots.length - 1)}
        y={height - 6}
        textAnchor="end"
        fill="#737373"
        fontSize="10"
      >
        now
      </text>
    </svg>
  );
}

function BreakdownBars({
  rows,
  color,
}: {
  rows: Array<{ value: string; count: number }>;
  color: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) {
    return <p className="text-sm text-neutral-500">No data yet.</p>;
  }
  return (
    <div className="space-y-3.5">
      {rows.map((row) => {
        const share = (row.count / total) * 100;
        return (
          <div key={row.value}>
            <div className="flex items-baseline justify-between gap-3 text-sm mb-1.5">
              <span className="truncate">{row.value}</span>
              <span className="shrink-0 tabular-nums text-neutral-400">
                {row.count.toLocaleString()}
                <span className="text-neutral-500 ml-2">
                  {share >= 10 ? Math.round(share) : share.toFixed(1)}%
                </span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(1, share)}%`,
                  backgroundColor: color,
                  opacity: 0.85,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RetentionChart({
  rows,
}: {
  rows: UsageData["analytics"]["retention"]["rows"];
}) {
  const width = 900;
  const height = 260;
  const margin = { top: 18, right: 18, bottom: 36, left: 44 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxDay = Math.max(1, ...rows.map((row) => row.dayOffset));
  const plottedRows = rows.filter(
    (row): row is typeof row & { percentage: number } => row.percentage !== null
  );
  const x = (dayOffset: number) => margin.left + (dayOffset / maxDay) * plotWidth;
  const y = (percentage: number) => margin.top + (1 - percentage / 100) * plotHeight;
  const linePath = plottedRows
    .map((row, index) => `${index === 0 ? "M" : "L"} ${x(row.dayOffset)} ${y(row.percentage)}`)
    .join(" ");
  const areaPath = plottedRows.length
    ? `${linePath} L ${x(plottedRows.at(-1)!.dayOffset)} ${margin.top + plotHeight} L ${x(plottedRows[0].dayOffset)} ${margin.top + plotHeight} Z`
    : "";
  const benchmarkDays = [1, 7, 14, 30];
  const axisDays = [0, 1, 3, 7, 14, 21, 30].filter((day) => day <= maxDay);

  if (!plottedRows.length) {
    return (
      <div className="h-56 grid place-items-center rounded-lg bg-white/[0.02] text-sm text-neutral-500">
        Retention appears after the first visitor is recorded.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {benchmarkDays.map((day) => {
          const row = rows.find((candidate) => candidate.dayOffset === day);
          return (
            <div key={day} className="rounded-lg bg-white/[0.04] px-3 py-2.5">
              <div className="text-lg font-semibold tabular-nums">
                {row?.percentage === null || row?.percentage === undefined
                  ? "—"
                  : formatPercentage(row.percentage)}
              </div>
              <div className="text-xs text-neutral-500">Day {day}</div>
            </div>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[720px] w-full h-auto"
          role="img"
          aria-label="Visitor retention by days since first visit"
        >
          <defs>
            <linearGradient id="retention-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.015" />
            </linearGradient>
          </defs>

          {[0, 25, 50, 75, 100].map((percentage) => (
            <g key={percentage}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y(percentage)}
                y2={y(percentage)}
                stroke="rgba(255,255,255,0.08)"
              />
              <text
                x={margin.left - 9}
                y={y(percentage) + 4}
                textAnchor="end"
                fill="#737373"
                fontSize="10"
              >
                {percentage}%
              </text>
            </g>
          ))}

          {axisDays.map((day) => (
            <text
              key={day}
              x={x(day)}
              y={height - 10}
              textAnchor="middle"
              fill="#737373"
              fontSize="10"
            >
              D{day}
            </text>
          ))}

          {areaPath && <path d={areaPath} fill="url(#retention-area)" />}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {plottedRows.map((row) => (
            <g key={row.dayOffset}>
              <circle
                cx={x(row.dayOffset)}
                cy={y(row.percentage)}
                r="10"
                fill="transparent"
              >
                <title>
                  {`Day ${row.dayOffset}: ${formatPercentage(row.percentage)} · ${row.returningVisitors} of ${row.eligibleVisitors} eligible visitors`}
                </title>
              </circle>
              <circle
                cx={x(row.dayOffset)}
                cy={y(row.percentage)}
                r={benchmarkDays.includes(row.dayOffset) || row.dayOffset === 0 ? 3.5 : 2}
                fill="#93c5fd"
                stroke="#171717"
                strokeWidth="1.5"
                pointerEvents="none"
              />
            </g>
          ))}
        </svg>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-neutral-500">
        Each point is the share of eligible first-time visitors active on that exact day after their first visit.
        Recent visitors are excluded from days they have not reached yet.
      </p>
    </div>
  );
}

function RankList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ value: string; count: number }>;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="p-5 rounded-xl bg-white/5 border border-white/10">
      <h2 className="font-semibold mb-4">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No data yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={`${row.value}-${row.count}`}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate" title={row.value}>{row.value}</span>
                <span className="text-neutral-400 tabular-nums">{row.count}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-400/70"
                  style={{ width: `${(row.count / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPercentage(value: number): string {
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
}
