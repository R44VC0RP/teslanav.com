"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SpeedCamera } from "@/types/speedcamera";
import type { MapBounds } from "@/types/waze";

interface UseSpeedCamerasOptions {
  bounds: MapBounds | null;
  refreshInterval?: number; // milliseconds
  debounceMs?: number;
  enabled?: boolean;
  minZoomLevel?: number;
  bufferMultiplier?: number; // fetch area larger than the viewport
}

// Check if viewport is fully contained within previously fetched bounds
function isContained(viewport: MapBounds, fetched: MapBounds): boolean {
  return (
    viewport.west >= fetched.west &&
    viewport.east <= fetched.east &&
    viewport.south >= fetched.south &&
    viewport.north <= fetched.north
  );
}

function expandBounds(bounds: MapBounds, multiplier: number): MapBounds {
  const horizontalPadding = (bounds.east - bounds.west) * ((multiplier - 1) / 2);
  const verticalPadding = (bounds.north - bounds.south) * ((multiplier - 1) / 2);
  return {
    west: bounds.west - horizontalPadding,
    east: bounds.east + horizontalPadding,
    south: bounds.south - verticalPadding,
    north: bounds.north + verticalPadding,
    zoom: bounds.zoom,
  };
}

/**
 * Fixed camera locations from our own SQLite via /api/speedcameras.
 * The data is static, so we refetch only when the viewport leaves the last
 * fetched area or on a slow periodic refresh.
 */
export function useSpeedCameras({
  bounds,
  refreshInterval = 600_000, // 10 minutes - fixed cameras rarely change
  debounceMs = 600,
  enabled = true,
  minZoomLevel = 10,
  bufferMultiplier = 2,
}: UseSpeedCamerasOptions) {
  const [cameras, setCameras] = useState<SpeedCamera[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastFetchedBounds = useRef<MapBounds | null>(null);
  const lastBounds = useRef<MapBounds | null>(null);
  const activeController = useRef<AbortController | null>(null);
  const requestTimestamps = useRef<number[]>([]);

  const canMakeRequest = useCallback((): boolean => {
    const now = Date.now();
    requestTimestamps.current = requestTimestamps.current.filter(
      (timestamp) => now - timestamp < 60_000
    );
    return requestTimestamps.current.length < 6;
  }, []);

  const fetchCameras = useCallback(
    async (currentBounds: MapBounds, force: boolean = false) => {
      if (!enabled) return;
      if (
        currentBounds.zoom !== undefined &&
        currentBounds.zoom < minZoomLevel
      ) {
        return;
      }
      if (
        !force &&
        lastFetchedBounds.current &&
        isContained(currentBounds, lastFetchedBounds.current)
      ) {
        return;
      }
      if (!canMakeRequest()) return;

      const expanded = expandBounds(currentBounds, bufferMultiplier);
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;

      try {
        setLoading(true);
        setError(null);
        requestTimestamps.current.push(Date.now());

        const params = new URLSearchParams({
          left: expanded.west.toString(),
          right: expanded.east.toString(),
          bottom: expanded.south.toString(),
          top: expanded.north.toString(),
        });
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const response = await fetch(`/api/speedcameras?${params}`, {
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (!response.ok) {
          throw new Error(`Failed to fetch speed cameras (${response.status})`);
        }

        const data = await response.json();
        setCameras(data.cameras || []);
        lastFetchedBounds.current = expanded;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (activeController.current === controller) {
          activeController.current = null;
          setLoading(false);
        }
      }
    },
    [enabled, canMakeRequest, minZoomLevel, bufferMultiplier]
  );

  // Debounced fetch when bounds change
  useEffect(() => {
    if (!bounds || !enabled) return;

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    lastBounds.current = bounds;
    debounceTimer.current = setTimeout(() => {
      fetchCameras(bounds);
    }, debounceMs);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [bounds, debounceMs, fetchCameras, enabled]);

  // Slow periodic refresh (picks up admin re-imports)
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      if (lastBounds.current) {
        fetchCameras(lastBounds.current, true);
      }
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval, fetchCameras, enabled]);

  useEffect(() => {
    return () => {
      activeController.current?.abort();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return {
    cameras,
    loading,
    error,
    refetch: () => bounds && fetchCameras(bounds, true),
  };
}
