"use client";

import { useState, useEffect, useLayoutEffect } from "react";

interface DailyUsage {
  date: string;
  count: number;
}

interface UsageStats {
  apiName: string;
  displayName: string;
  currentUsage: number;
  limit: number;
  percentUsed: number;
  dailyUsage: DailyUsage[];
  status: "ok" | "warning" | "critical" | "exceeded";
  alertsTriggered: number[];
}

interface UsageResponse {
  stats: UsageStats[];
  summary: {
    totalUsage: number;
    totalLimit: number;
    percentUsed: number;
    billingPeriod: string;
  };
}

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncValues, setSyncValues] = useState<Record<string, string>>({});
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Enable scrolling on this page (override global overflow:hidden for map)
  useLayoutEffect(() => {
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "auto";
    
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, []);

  // Check if we have a stored secret
  useEffect(() => {
    const storedSecret = localStorage.getItem("teslanav-admin-secret");
    if (storedSecret) {
      setSecret(storedSecret);
      fetchUsage(storedSecret);
    }
  }, []);

  const fetchUsage = async (adminSecret: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/usage", {
        headers: {
          Authorization: `Bearer ${adminSecret}`,
        },
      });

      if (response.status === 401) {
        setError("Invalid admin secret");
        setIsAuthenticated(false);
        localStorage.removeItem("teslanav-admin-secret");
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to fetch usage data");
      }

      const usageData = await response.json();
      setData(usageData);
      setIsAuthenticated(true);
      setLastRefresh(new Date());
      localStorage.setItem("teslanav-admin-secret", adminSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsage(secret);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setData(null);
    setSecret("");
    localStorage.removeItem("teslanav-admin-secret");
  };

  const handleSyncUsage = async () => {
    setSyncLoading(true);
    setSyncMessage(null);

    try {
      const updates = Object.entries(syncValues).filter(([, value]) => value.trim() !== "");
      
      if (updates.length === 0) {
        setSyncMessage({ type: "error", text: "Please enter at least one usage value" });
        setSyncLoading(false);
        return;
      }

      for (const [apiName, value] of updates) {
        const usage = parseInt(value, 10);
        if (isNaN(usage) || usage < 0) {
          setSyncMessage({ type: "error", text: `Invalid value for ${apiName}` });
          setSyncLoading(false);
          return;
        }

        const response = await fetch("/api/admin/usage", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ apiName, usage }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Failed to update");
        }
      }

      setSyncMessage({ type: "success", text: "Usage synced successfully!" });
      setSyncValues({});
      fetchUsage(secret); // Refresh the data
      
      // Close modal after 1.5 seconds
      setTimeout(() => {
        setShowSyncModal(false);
        setSyncMessage(null);
      }, 1500);
    } catch (err) {
      setSyncMessage({ type: "error", text: err instanceof Error ? err.message : "Sync failed" });
    } finally {
      setSyncLoading(false);
    }
  };

  const getStatusColor = (status: UsageStats["status"]) => {
    switch (status) {
      case "exceeded":
        return "text-red-400 bg-red-500/10 border-red-500/20";
      case "critical":
        return "text-orange-400 bg-orange-500/10 border-orange-500/20";
      case "warning":
        return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
      default:
        return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    }
  };

  const getStatusLabel = (status: UsageStats["status"]) => {
    switch (status) {
      case "exceeded":
        return "Exceeded";
      case "critical":
        return "Critical";
      case "warning":
        return "Warning";
      default:
        return "Healthy";
    }
  };

  const getProgressColor = (percent: number) => {
    if (percent >= 100) return "bg-red-500";
    if (percent >= 90) return "bg-orange-500";
    if (percent >= 75) return "bg-yellow-500";
    return "bg-emerald-500";
  };

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-[#141414] border border-white/10 rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <ShieldIcon className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-white">Admin Access</h1>
                <p className="text-sm text-gray-500">TeslaNav Dashboard</p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Admin Secret</label>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="Enter admin secret..."
                  className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
                />
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !secret}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-xl transition-colors"
              >
                {loading ? "Authenticating..." : "Access Dashboard"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold">
              T
            </div>
            <div>
              <h1 className="font-semibold">TeslaNav Admin</h1>
              <p className="text-sm text-gray-500">API Usage Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {lastRefresh && (
              <span className="text-sm text-gray-500">
                Last updated: {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => fetchUsage(secret)}
              disabled={loading}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              <RefreshIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={() => setShowSyncModal(true)}
              className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-lg text-blue-400 text-sm transition-colors flex items-center gap-2"
            >
              <SyncIcon className="w-4 h-4" />
              Sync with Mapbox
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 text-sm transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Summary Cards */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <SummaryCard
              label="Billing Period"
              value={data.summary.billingPeriod}
              icon={<CalendarIcon className="w-5 h-5" />}
            />
            <SummaryCard
              label="Total Requests"
              value={data.summary.totalUsage.toLocaleString()}
              icon={<ChartIcon className="w-5 h-5" />}
            />
            <SummaryCard
              label="Total Limit"
              value={data.summary.totalLimit.toLocaleString()}
              icon={<LimitIcon className="w-5 h-5" />}
            />
            <SummaryCard
              label="Overall Usage"
              value={`${data.summary.percentUsed}%`}
              icon={<PieIcon className="w-5 h-5" />}
              highlight={data.summary.percentUsed >= 75}
            />
          </div>
        )}

        {/* API Usage Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data?.stats.map((stat) => (
            <div
              key={stat.apiName}
              className="bg-[#141414] border border-white/10 rounded-2xl p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{stat.displayName}</h3>
                  <p className="text-sm text-gray-500">{stat.apiName}</p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(stat.status)}`}
                >
                  {getStatusLabel(stat.status)}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">
                    {stat.currentUsage.toLocaleString()} requests
                  </span>
                  <span className="text-gray-500">
                    {stat.limit.toLocaleString()} limit
                  </span>
                </div>
                <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getProgressColor(stat.percentUsed)} transition-all duration-500`}
                    style={{ width: `${Math.min(stat.percentUsed, 100)}%` }}
                  />
                </div>
                <div className="text-right mt-1">
                  <span className={`text-sm font-medium ${stat.percentUsed >= 90 ? "text-red-400" : stat.percentUsed >= 75 ? "text-yellow-400" : "text-gray-400"}`}>
                    {stat.percentUsed.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Mini Chart */}
              <div className="mt-4">
                <p className="text-xs text-gray-500 mb-2">Last 14 days</p>
                <div className="flex items-end gap-1 h-16">
                  {stat.dailyUsage.map((day, i) => {
                    const maxCount = Math.max(...stat.dailyUsage.map(d => d.count), 1);
                    const height = (day.count / maxCount) * 100;
                    return (
                      <div
                        key={day.date}
                        className="flex-1 group relative"
                      >
                        <div
                          className={`w-full rounded-t ${i === stat.dailyUsage.length - 1 ? "bg-blue-500" : "bg-white/20"} transition-all hover:bg-blue-400`}
                          style={{ height: `${Math.max(height, 4)}%` }}
                        />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black border border-white/20 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                          {day.date}: {day.count.toLocaleString()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Alerts Triggered */}
              {stat.alertsTriggered.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-xs text-gray-500 mb-2">Alerts sent this month</p>
                  <div className="flex gap-2">
                    {stat.alertsTriggered.map((threshold) => (
                      <span
                        key={threshold}
                        className="px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-400"
                      >
                        {threshold}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Alert Settings */}
        <div className="mt-8 bg-[#141414] border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BellIcon className="w-5 h-5 text-blue-400" />
            Email Notifications
          </h3>
          <p className="text-gray-400 text-sm mb-4">
            Get notified when API usage crosses 50%, 75%, 90%, and 100% thresholds.
          </p>
          <div className="flex gap-4">
            <input
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="your@email.com"
              className="flex-1 max-w-md px-4 py-2 bg-black/50 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
            />
            <button
              onClick={() => {
                localStorage.setItem("teslanav-notify-email", notifyEmail);
                alert("Email saved! Alerts will be sent when thresholds are crossed.");
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              Save
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            Note: Requires RESEND_API_KEY environment variable to be configured.
          </p>
        </div>

        {/* Thresholds Info */}
        <div className="mt-6 grid grid-cols-4 gap-4">
          {[
            { threshold: 50, label: "Watch", color: "blue" },
            { threshold: 75, label: "Warning", color: "yellow" },
            { threshold: 90, label: "Critical", color: "orange" },
            { threshold: 100, label: "Exceeded", color: "red" },
          ].map(({ threshold, label, color }) => (
            <div
              key={threshold}
              className={`p-4 rounded-xl border bg-${color}-500/5 border-${color}-500/20`}
              style={{
                backgroundColor: `rgba(${color === "blue" ? "59, 130, 246" : color === "yellow" ? "234, 179, 8" : color === "orange" ? "249, 115, 22" : "239, 68, 68"}, 0.05)`,
                borderColor: `rgba(${color === "blue" ? "59, 130, 246" : color === "yellow" ? "234, 179, 8" : color === "orange" ? "249, 115, 22" : "239, 68, 68"}, 0.2)`,
              }}
            >
              <div className="text-2xl font-bold" style={{ color: color === "blue" ? "#3b82f6" : color === "yellow" ? "#eab308" : color === "orange" ? "#f97316" : "#ef4444" }}>
                {threshold}%
              </div>
              <div className="text-sm text-gray-400">{label}</div>
            </div>
          ))}
        </div>
      </main>

      {/* Sync Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#141414] border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <SyncIcon className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Sync with Mapbox</h2>
                  <p className="text-sm text-gray-500">Enter values from your Mapbox dashboard</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowSyncModal(false);
                  setSyncMessage(null);
                  setSyncValues({});
                }}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 mb-6">
              <p className="text-sm text-gray-400">
                Go to{" "}
                <a
                  href="https://account.mapbox.com/statistics/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  account.mapbox.com/statistics
                </a>{" "}
                and enter your current monthly usage below:
              </p>

              {[
                { key: "geocoding", label: "Geocoding API v6", placeholder: "e.g., 35000" },
                { key: "reverse_geocoding", label: "Reverse Geocoding (Temporary)", placeholder: "e.g., 35304" },
                { key: "map_loads", label: "Map Loads", placeholder: "e.g., 8800" },
                { key: "directions", label: "Directions API", placeholder: "e.g., 5000" },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-sm text-gray-400 mb-1.5">{label}</label>
                  <input
                    type="number"
                    min="0"
                    value={syncValues[key] || ""}
                    onChange={(e) => setSyncValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full px-4 py-2.5 bg-black/50 border border-white/10 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
                  />
                </div>
              ))}
            </div>

            {syncMessage && (
              <div
                className={`mb-4 px-4 py-3 rounded-lg text-sm ${
                  syncMessage.type === "success"
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                    : "bg-red-500/10 border border-red-500/20 text-red-400"
                }`}
              >
                {syncMessage.text}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowSyncModal(false);
                  setSyncMessage(null);
                  setSyncValues({});
                }}
                className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSyncUsage}
                disabled={syncLoading}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {syncLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Syncing...
                  </>
                ) : (
                  "Sync Usage"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`p-4 rounded-xl border ${highlight ? "bg-yellow-500/5 border-yellow-500/20" : "bg-[#141414] border-white/10"}`}>
      <div className="flex items-center gap-2 text-gray-400 mb-1">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className={`text-2xl font-semibold ${highlight ? "text-yellow-400" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

// Icons
function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function LimitIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PieIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function SyncIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

