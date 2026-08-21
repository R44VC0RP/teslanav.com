"use client";

import type { SpeedLimitValue, SpeedUnit } from "@/types/speedlimit";

interface SpeedDisplayProps {
  speedMetersPerSecond: number | null;
  speedLimit: SpeedLimitValue | null;
  isDarkMode: boolean;
}

function convertSpeed(speedMetersPerSecond: number, unit: SpeedUnit): number {
  return unit === "mph"
    ? speedMetersPerSecond * 2.236936
    : speedMetersPerSecond * 3.6;
}

function speedLimitInMetersPerSecond(speedLimit: SpeedLimitValue): number {
  return speedLimit.unit === "mph"
    ? speedLimit.value / 2.236936
    : speedLimit.value / 3.6;
}

export function SpeedDisplay({
  speedMetersPerSecond,
  speedLimit,
  isDarkMode,
}: SpeedDisplayProps) {
  const displayUnit = speedLimit?.unit ?? "mph";
  const currentSpeed = speedMetersPerSecond === null
    ? null
    : Math.max(0, Math.round(convertSpeed(speedMetersPerSecond, displayUnit)));
  const isSpeeding =
    speedMetersPerSecond !== null &&
    speedLimit !== null &&
    speedMetersPerSecond > speedLimitInMetersPerSecond(speedLimit) + 0.5;

  return (
    <div className="flex items-end gap-2" aria-label="Driving speed">
      <div
        className={`
          flex h-[88px] w-[88px] flex-col items-center justify-center rounded-2xl border
          backdrop-blur-xl shadow-lg
          ${isDarkMode ? "border-white/10 bg-[#1a1a1a]/80 text-white" : "border-black/10 bg-white/80 text-black"}
        `}
      >
        <span
          className={`text-4xl font-bold tabular-nums leading-none ${isSpeeding ? "text-red-500" : ""}`}
        >
          {currentSpeed ?? "—"}
        </span>
        <span className={`mt-1 text-[11px] font-semibold uppercase tracking-wider ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
          {displayUnit}
        </span>
      </div>

      {speedLimit && (
        <div
          className="flex h-[76px] w-[76px] flex-col items-center justify-center rounded-full border-[6px] border-red-500 bg-white text-black shadow-lg"
          aria-label={`Speed limit ${speedLimit.value} ${speedLimit.unit}`}
        >
          <span className="text-[10px] font-bold uppercase leading-none tracking-tight">
            Speed
          </span>
          <span className="text-3xl font-black tabular-nums leading-none">
            {Math.round(speedLimit.value)}
          </span>
          <span className="text-[10px] font-bold uppercase leading-none tracking-tight">
            Limit
          </span>
        </div>
      )}
    </div>
  );
}
