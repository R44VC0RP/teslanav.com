import { timezoneToCountry } from "@/lib/analytics-insights";

/**
 * Locale-aware units, detected client-side with zero new data collection:
 * the device timezone maps to a country (same helper the analytics use),
 * with the browser locale region as fallback.
 */

export type UnitSystem = "imperial" | "metric";

// Countries whose road signage uses miles / mph.
const IMPERIAL_COUNTRIES = new Set([
  "US", "GB", "LR", "MM", "BS", "BZ", "KY", "BM", "AG", "DM", "GD", "KN",
  "LC", "VC", "VG", "AI", "MS", "TC", "PR", "GU", "VI", "AS", "MP",
]);

export function detectUnitSystem(): UnitSystem {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const country = timezoneToCountry(timezone);
    if (/^[A-Z]{2}$/.test(country)) {
      return IMPERIAL_COUNTRIES.has(country) ? "imperial" : "metric";
    }
  } catch {
    // Fall through to locale.
  }
  if (typeof navigator !== "undefined") {
    const region = navigator.language?.split("-")[1]?.toUpperCase();
    if (region && /^[A-Z]{2}$/.test(region)) {
      return IMPERIAL_COUNTRIES.has(region) ? "imperial" : "metric";
    }
  }
  return "metric";
}

const KM_PER_MILE = 1.609344;

/**
 * Normalize a stored speed limit to km/h.
 * - "35 mph" (OSM US tagging) → mph
 * - bare numbers from the DC dataset → mph (US signage)
 * - bare numbers from OSM → km/h by OSM convention
 */
export function maxspeedToKmh(
  raw: string,
  source: string | undefined
): number | null {
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(mph|knots)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === "mph") return value * KM_PER_MILE;
  if (unit === "knots") return value * 1.852;
  if (source === "dc" || source === "chicago") return value * KM_PER_MILE;
  return value;
}

/** Format a stored speed limit in the viewer's unit system. */
export function formatSpeedLimit(
  raw: string,
  source: string | undefined,
  system: UnitSystem
): string {
  const kmh = maxspeedToKmh(raw, source);
  if (kmh === null) return raw;
  return system === "imperial"
    ? `${Math.round(kmh / KM_PER_MILE)} mph`
    : `${Math.round(kmh)} km/h`;
}
