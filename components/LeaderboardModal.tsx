"use client";

import { useEffect } from "react";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { SparklesIcon } from "@heroicons/react/24/solid";

interface LeaderboardModalProps {
  superchargerId: string;
  superchargerName: string;
  isOpen: boolean;
  onClose: () => void;
  darkMode?: boolean;
}

export function LeaderboardModal({
  superchargerId,
  superchargerName,
  isOpen,
  onClose,
  darkMode = false,
}: LeaderboardModalProps) {
  const { entries, isLoading, error, vipUserId, fetchLeaderboard } = useLeaderboard();

  useEffect(() => {
    if (isOpen) {
      fetchLeaderboard(superchargerId);
    }
  }, [isOpen, superchargerId, fetchLeaderboard]);

  if (!isOpen) return null;

  const bgClass = darkMode
    ? "bg-[#1a1a1a]/95 text-white border-white/10"
    : "bg-white/95 text-black border-black/10";

  const rowClass = (index: number) =>
    index === 0
      ? darkMode
        ? "bg-yellow-500/10 border-yellow-500/20"
        : "bg-yellow-400/10 border-yellow-400/20"
      : "";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div
        className={`${bgClass} border rounded-lg p-6 w-full max-w-md max-h-[80vh] overflow-y-auto shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sticky top-0 -mx-6 px-6 py-4 bg-inherit border-b">
          <h2 className="text-xl font-bold">Check-in Leaderboard</h2>
          <button
            onClick={onClose}
            className="text-xl hover:opacity-70 transition"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Subheader */}
        <p className="text-sm opacity-70 mb-4">{superchargerName}</p>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-8 opacity-70">Loading leaderboard...</div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3 mb-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Entries */}
        {!isLoading && entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry, index) => (
              <div
                key={entry.userId}
                className={`flex items-center justify-between p-3 rounded border transition ${rowClass(index)} ${
                  darkMode ? "border-white/10" : "border-black/10"
                }`}
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="font-bold w-6 text-center">{entry.rank}</div>
                  <div className="flex-1">
                    <div className="font-medium">
                      {entry.email?.split("@")[0] || `User ${entry.userId.slice(0, 8)}`}
                    </div>
                    {entry.isVIP && (
                      <div className="text-xs text-yellow-400 flex items-center gap-1 mt-0.5">
                        <SparklesIcon className="w-3 h-3" />
                        VIP
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{entry.checkInCount}</div>
                  <div className="text-xs opacity-70">
                    {entry.checkInCount === 1 ? "check-in" : "check-ins"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* No entries */}
        {!isLoading && entries.length === 0 && !error && (
          <div className="text-center py-8 opacity-70">
            No check-ins yet. Be the first!
          </div>
        )}
      </div>
    </div>
  );
}
