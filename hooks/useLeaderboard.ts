import { useState, useCallback } from "react";
import type { LeaderboardEntry } from "@/types/checkin";

interface UseLeaderboardReturn {
  entries: LeaderboardEntry[];
  isLoading: boolean;
  error: string | null;
  vipUserId?: string;
  fetchLeaderboard: (superchargerId: string) => Promise<void>;
}

export function useLeaderboard(): UseLeaderboardReturn {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vipUserId, setVipUserId] = useState<string>();

  const fetchLeaderboard = useCallback(async (superchargerId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/superchargers/${superchargerId}/leaderboard?limit=10`,
        { method: "GET", credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch leaderboard");
      }

      const data = await response.json();
      setEntries(data.entries || []);
      setVipUserId(data.vipUserId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    entries,
    isLoading,
    error,
    vipUserId,
    fetchLeaderboard,
  };
}
