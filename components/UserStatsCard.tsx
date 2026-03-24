"use client";

import { useState, useEffect } from "react";
import { useAuthContext } from "./AuthProvider";
import { BoltIcon, SparklesIcon } from "@heroicons/react/24/solid";

interface UserStats {
  totalCheckIns: number;
  vipLocations: string[];
  vipCount: number;
}

interface UserStatsCardProps {
  darkMode?: boolean;
}

export function UserStatsCard({ darkMode = false }: UserStatsCardProps) {
  const { user, token } = useAuthContext();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!user || !token) return;

    const fetchStats = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/users/me", {
          headers: { "Authorization": `Bearer ${token}` },
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          setStats(data.stats);
        }
      } catch (error) {
        console.error("Failed to fetch stats:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [user, token]);

  if (!user) return null;

  const bgClass = darkMode
    ? "bg-[#2a2a2a] text-white border-white/10"
    : "bg-white text-black border-black/10";

  if (isLoading) {
    return (
      <div className={`${bgClass} border rounded-lg p-4 animate-pulse`}>
        <div className="h-4 bg-gray-400/20 rounded w-1/3 mb-2"></div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-400/20 rounded"></div>
          <div className="h-3 bg-gray-400/20 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${bgClass} border rounded-lg p-4 space-y-4`}>
      {/* User Info */}
      <div>
        <div className="text-sm opacity-70">Signed in as</div>
        <div className="font-semibold">{user.email}</div>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 gap-3">
          <div className={`rounded p-3 ${darkMode ? "bg-white/5" : "bg-black/5"}`}>
            <div className="flex items-center gap-1 mb-1">
              <BoltIcon className="w-4 h-4" />
              <div className="text-xs opacity-70">Check-ins</div>
            </div>
            <div className="text-2xl font-bold">{stats.totalCheckIns}</div>
          </div>

          <div className={`rounded p-3 ${darkMode ? "bg-white/5" : "bg-black/5"}`}>
            <div className="flex items-center gap-1 mb-1">
              <SparklesIcon className="w-4 h-4 text-yellow-400" />
              <div className="text-xs opacity-70">VIP Sites</div>
            </div>
            <div className="text-2xl font-bold">{stats.vipCount}</div>
          </div>
        </div>
      )}

      {/* VIP Locations */}
      {stats && stats.vipLocations && stats.vipLocations.length > 0 && (
        <div>
          <div className="text-sm font-medium mb-2">VIP at</div>
          <div className="space-y-1">
            {stats.vipLocations.map((location) => (
              <div key={location} className="text-sm opacity-75 truncate">
                • {location}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
