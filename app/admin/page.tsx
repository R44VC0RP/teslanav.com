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
}

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

            {/* Engagement and load */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section>
                <h2 className="text-xl font-semibold mb-3">Engagement today</h2>
                <div className="grid grid-cols-2 gap-4">
                  <StatCard label="Sessions" value={data.analytics.engagement.sessionsToday} />
                  <StatCard label="Pageviews" value={data.analytics.engagement.pageviewsToday} />
                  <StatCard
                    label="Engaged time"
                    value={formatDuration(data.analytics.engagement.activeSecondsToday)}
                  />
                  <StatCard
                    label="Avg session · 30d"
                    value={formatDuration(data.analytics.engagement.averageSessionSecondsThirtyDays)}
                  />
                </div>
              </section>
              <section>
                <h2 className="text-xl font-semibold mb-3">Application load</h2>
                <div className="grid grid-cols-2 gap-4">
                  <StatCard label="Requests this hour" value={data.analytics.load.requestsCurrentHour} />
                  <StatCard label="Requests today" value={data.analytics.load.requestsToday} />
                  <StatCard label="Redis keys" value={data.redis.ok ? data.redis.cachedKeys : "down"} />
                  <StatCard label="Heap used" value={formatBytes(data.system.heapUsedBytes)} />
                </div>
              </section>
            </div>

            {/* 14-day activity */}
            <section className="p-5 rounded-xl bg-white/5 border border-white/10">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-semibold">Visitors · 14 days</h2>
                <span className="text-xs text-neutral-500">UTC</span>
              </div>
              <DailyBars rows={data.analytics.daily} />
            </section>

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

function DailyBars({ rows }: { rows: UsageData["analytics"]["daily"] }) {
  const max = Math.max(1, ...rows.map((row) => row.visitors));
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-[repeat(14,minmax(0,1fr))] gap-2 h-44 items-end">
        {rows.map((row) => (
          <div key={row.day} className="h-full flex flex-col justify-end items-center gap-2">
            <span className="text-xs text-neutral-400 tabular-nums">{row.visitors}</span>
            <div className="w-full h-28 flex items-end rounded-lg bg-white/[0.03] overflow-hidden">
              <div
                className="w-full rounded-lg bg-blue-500/80 min-h-[2px]"
                style={{ height: `${(row.visitors / max) * 100}%` }}
                title={`${row.visitors} users, ${row.sessions} sessions, ${formatDuration(row.activeSeconds)}`}
              />
            </div>
            <span className="text-[10px] text-neutral-500 tabular-nums">
              {row.day.slice(5)}
            </span>
          </div>
        ))}
      </div>
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
