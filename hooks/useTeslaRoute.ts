"use client";

import { useEffect, useState } from "react";
import type { RouteData } from "@/types/route";
import type { TeslaRoute } from "@/types/tesla";

interface TeslaRouteState {
  linked: boolean;
  subscribed: boolean;
  route: RouteData | null;
  details: TeslaRoute | null;
}

const INITIAL_STATE: TeslaRouteState = {
  linked: false,
  subscribed: false,
  route: null,
  details: null,
};

export function useTeslaRoute(): TeslaRouteState {
  const [state, setState] = useState<TeslaRouteState>(INITIAL_STATE);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/tesla/route", { cache: "no-store" });
        const data = (await response.json()) as {
          linked?: boolean;
          subscribed?: boolean;
          route?: TeslaRoute | null;
        };
        if (!active) return;
        const teslaRoute = data.route ?? null;
        setState({
          linked: data.linked ?? false,
          subscribed: data.subscribed ?? false,
          details: teslaRoute,
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
      } catch {
        // Keep the last route during temporary connectivity loss.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return state;
}
