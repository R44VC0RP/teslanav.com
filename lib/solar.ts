const OFFICIAL_ZENITH = 90.833;
const HOUR_MS = 60 * 60 * 1000;

export interface SolarTheme {
  isDark: boolean;
  sunrise: Date | null;
  sunset: Date | null;
  nightStarts: Date | null;
  dayStarts: Date | null;
  polarState: "day" | "night" | null;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalizeHours(value: number): number {
  return ((value % 24) + 24) % 24;
}

function dayOfYear(date: Date): number {
  const year = date.getFullYear();
  const start = Date.UTC(year, 0, 0);
  const current = Date.UTC(year, date.getMonth(), date.getDate());
  return Math.floor((current - start) / 86_400_000);
}

function alignToLocalDate(candidate: Date, target: Date): Date {
  const targetDay = Date.UTC(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  );
  const candidateDay = Date.UTC(
    candidate.getFullYear(),
    candidate.getMonth(),
    candidate.getDate()
  );
  const dayOffset = Math.round((targetDay - candidateDay) / 86_400_000);
  if (dayOffset === 0) return candidate;
  const adjusted = new Date(candidate);
  adjusted.setUTCDate(adjusted.getUTCDate() + dayOffset);
  return adjusted;
}

function calculateSunEvent(
  date: Date,
  latitude: number,
  longitude: number,
  sunrise: boolean
): { time: Date | null; polarState: "day" | "night" | null } {
  const n = dayOfYear(date);
  const longitudeHour = longitude / 15;
  const approximateTime =
    n + ((sunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
      1.916 * Math.sin((meanAnomaly * Math.PI) / 180) +
      0.02 * Math.sin((2 * meanAnomaly * Math.PI) / 180) +
      282.634
  );

  let rightAscension = normalizeDegrees(
    (Math.atan(0.91764 * Math.tan((trueLongitude * Math.PI) / 180)) * 180) /
      Math.PI
  );
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const ascensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - ascensionQuadrant) / 15;

  const sinDeclination =
    0.39782 * Math.sin((trueLongitude * Math.PI) / 180);
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const latitudeRadians = (latitude * Math.PI) / 180;
  const cosHourAngle =
    (Math.cos((OFFICIAL_ZENITH * Math.PI) / 180) -
      sinDeclination * Math.sin(latitudeRadians)) /
    (cosDeclination * Math.cos(latitudeRadians));

  if (cosHourAngle > 1) return { time: null, polarState: "night" };
  if (cosHourAngle < -1) return { time: null, polarState: "day" };

  let hourAngle =
    (Math.acos(cosHourAngle) * 180) / Math.PI;
  if (sunrise) hourAngle = 360 - hourAngle;
  hourAngle /= 15;

  const localMeanTime =
    hourAngle + rightAscension - 0.06571 * approximateTime - 6.622;
  const utcHours = normalizeHours(localMeanTime - longitudeHour);
  const utcMidnight = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const candidate = new Date(utcMidnight + utcHours * HOUR_MS);
  return {
    time: alignToLocalDate(candidate, date),
    polarState: null,
  };
}

/**
 * Automatic theme window for a physical location:
 * dark from one hour before sunset through one hour after sunrise.
 */
export function getSolarTheme(
  now: Date,
  latitude: number,
  longitude: number
): SolarTheme {
  const rise = calculateSunEvent(now, latitude, longitude, true);
  const set = calculateSunEvent(now, latitude, longitude, false);
  const polarState = rise.polarState ?? set.polarState;

  if (polarState) {
    return {
      isDark: polarState === "night",
      sunrise: null,
      sunset: null,
      nightStarts: null,
      dayStarts: null,
      polarState,
    };
  }

  const sunrise = rise.time;
  const sunset = set.time;
  if (!sunrise || !sunset) {
    return {
      isDark: true,
      sunrise,
      sunset,
      nightStarts: null,
      dayStarts: null,
      polarState: "night",
    };
  }

  const dayStarts = new Date(sunrise.getTime() + HOUR_MS);
  const nightStarts = new Date(sunset.getTime() - HOUR_MS);
  return {
    isDark: now < dayStarts || now >= nightStarts,
    sunrise,
    sunset,
    dayStarts,
    nightStarts,
    polarState: null,
  };
}
