import type { WazeAlert } from "@/types/waze";

/**
 * First-party user reports (police, hazards, etc.) submitted from the map.
 *
 * Reports are stored in SQLite and merged into /api/waze responses alongside
 * Waze data. They are never sent upstream to Waze (lib/waze-rt.ts is
 * read-only by design). This module is client-safe: constants and pure
 * helpers only, no database or Redis imports.
 */

export const USER_REPORT_TYPES = [
  "POLICE",
  "ACCIDENT",
  "HAZARD",
  "ROAD_CLOSED",
  "JAM",
] as const;

export type UserReportType = (typeof USER_REPORT_TYPES)[number];

// How long a fresh report stays on the map. A duplicate report nearby renews
// the window instead of creating a second marker.
export const USER_REPORT_TTL_MS: Record<UserReportType, number> = {
  POLICE: 45 * 60_000,
  ACCIDENT: 60 * 60_000,
  HAZARD: 2 * 60 * 60_000,
  ROAD_CLOSED: 4 * 60 * 60_000,
  JAM: 30 * 60_000,
};

// Confirmations can extend a report to at most this multiple of its base TTL,
// so nothing lives forever on repeated thumbs-up.
export const USER_REPORT_MAX_LIFETIME_MULTIPLIER = 3;

// Same-type reports within this box (~250m) merge into one confirmation.
export const USER_REPORT_MERGE_RADIUS_DEG = 0.0025;

export const USER_REPORT_PROVIDER = "teslanav-user";

export interface UserReport {
  id: string;
  type: UserReportType;
  lat: number;
  lon: number;
  createdAt: number;
  expiresAt: number;
  confirmations: number;
}

/**
 * Shape a stored report like a Waze alert so the map, clustering, popups,
 * and client tile cache need no special handling. The `alert-user/` prefix
 * cannot collide with RT/GeoRSS ids (`alert-<numeric>/<uuid>`).
 */
export function userReportToWazeAlert(report: UserReport): WazeAlert {
  return {
    id: `alert-user/${report.id}`,
    type: report.type,
    location: { x: report.lon, y: report.lat },
    reportDescription: "Reported by a TeslaNav driver",
    reliability: Math.min(10, 6 + report.confirmations),
    ...(report.confirmations > 0 ? { nThumbsUp: report.confirmations } : {}),
    pubMillis: report.createdAt,
    provider: USER_REPORT_PROVIDER,
  };
}
