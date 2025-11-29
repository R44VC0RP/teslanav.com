"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { WazeAlert, MapBounds } from "@/types/waze";

interface UseWazeAlertsOptions {
  bounds: MapBounds | null;
  refreshInterval?: number; // milliseconds
  debounceMs?: number;
}

export function useWazeAlerts({
  bounds,
  refreshInterval = 30000, // 30 seconds
  debounceMs = 500,
}: UseWazeAlertsOptions) {
  const [alerts, setAlerts] = useState<WazeAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastBounds = useRef<MapBounds | null>(null);

  const fetchAlerts = useCallback(async (currentBounds: MapBounds) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        left: currentBounds.west.toString(),
        right: currentBounds.east.toString(),
        bottom: currentBounds.south.toString(),
        top: currentBounds.north.toString(),
      });

      const response = await fetch(`/api/waze?${params}`);

      if (!response.ok) {
        throw new Error("Failed to fetch Waze alerts");
      }

      const data = await response.json();
      setAlerts(data.alerts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced fetch when bounds change
  useEffect(() => {
    if (!bounds) return;

    // Clear existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Debounce the fetch
    debounceTimer.current = setTimeout(() => {
      lastBounds.current = bounds;
      fetchAlerts(bounds);
    }, debounceMs);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [bounds, debounceMs, fetchAlerts]);

  // Periodic refresh
  useEffect(() => {
    if (!lastBounds.current) return;

    const interval = setInterval(() => {
      if (lastBounds.current) {
        fetchAlerts(lastBounds.current);
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval, fetchAlerts]);

  return { alerts, loading, error, refetch: () => bounds && fetchAlerts(bounds) };
}

