"use client";

import { SparklesIcon } from "@heroicons/react/24/solid";

interface VIPBadgeProps {
  userName?: string;
  checkInCount: number;
  darkMode?: boolean;
}

export function VIPBadge({ userName, checkInCount, darkMode = false }: VIPBadgeProps) {
  const bgClass = darkMode
    ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    : "bg-yellow-400/20 text-yellow-600 border-yellow-400/30";

  return (
    <div className={`${bgClass} border rounded-lg p-3 flex items-center gap-2`}>
      <SparklesIcon className="w-5 h-5 flex-shrink-0" />
      <div>
        <div className="font-bold text-sm">VIP at this Location</div>
        {userName && (
          <div className="text-xs opacity-80">
            {userName} has {checkInCount} check-ins
          </div>
        )}
      </div>
    </div>
  );
}
