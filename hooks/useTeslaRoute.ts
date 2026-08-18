"use client";

import { useEffect, useState } from "react";
import type { RouteData } from "@/types/route";
import type { TeslaRoute } from "@/types/tesla";

interface TeslaRouteState {
  linked: boolean;
  subscribed: boolean;
  route: RouteData | null;
  details: TeslaRoute | null;
  isOffline: boolean;
  lastSuccessfulAt: string | null;
}

const INITIAL_STATE: TeslaRouteState = {
  linked: false,
  subscribed: false,
  route: null,
  details: null,
  isOffline: false,
  lastSuccessfulAt: null,
};

export function useTeslaRoute(): TeslaRouteState {
  const [state, setState] = useState<TeslaRouteState>(INITIAL_STATE);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let retryDelay = 10_000;
    const load = async (): Promise<boolean> => {
      try {
        const response = await fetch("/api/tesla/route", { cache: "no-store" });
        if (response.status >= 500) throw new Error("Route service unavailable");
        const data = (await response.json()) as {
          linked?: boolean;
          subscribed?: boolean;
          route?: TeslaRoute | null;
        };
        if (!active) return true;
        const teslaRoute = data.route ?? null;
        setState({
          linked: data.linked ?? false,
          subscribed: data.subscribed ?? false,
          details: teslaRoute,
          isOffline: false,
          lastSuccessfulAt: new Date().toISOString(),
          route:
            teslaRoute && teslaRoute.coordinates.length >= 2
              ? {
                  id: `tesla-${teslaRoute.updatedAt}`,
                  geometry: {
                    type: "LineString",
                    coordinates: teslaRoute.coordinates,
                  },
                  distance: (teslaRoute.milesToArrival ?? 0) * 1609.344,
                  duration: (teslaRoute.minutesToArrival ?? 0) * 60,
                  steps: [],
                  summary:
                    teslaRoute.destinationName ?? "Tesla navigation route",
                }
              : null,
        });
        return true;
      } catch {
        if (active) {
          setState((previous) => ({ ...previous, isOffline: true }));
        }
        return false;
      }
    };

    const poll = async () => {
      const succeeded = await load();
      retryDelay = succeeded ? 10_000 : Math.min(retryDelay * 2, 60_000);
      if (active) timer = window.setTimeout(() => void poll(), retryDelay);
    };
    void poll();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return state;
}
