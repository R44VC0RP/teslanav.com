"use client";

import { useEffect, useState } from "react";
import { getSolarTheme, type SolarTheme } from "@/lib/solar";

const DEFAULT_THEME: SolarTheme = {
  isDark: true,
  sunrise: null,
  sunset: null,
  dayStarts: null,
  nightStarts: null,
  polarState: null,
};

export function useSolarTheme(
  latitude: number | null,
  longitude: number | null
): SolarTheme {
  const [theme, setTheme] = useState<SolarTheme>(DEFAULT_THEME);

  useEffect(() => {
    if (latitude === null || longitude === null) return;

    const update = () => {
      setTheme(getSolarTheme(new Date(), latitude, longitude));
    };
    const initial = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [latitude, longitude]);

  return theme;
}
