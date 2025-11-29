"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SpeedCamera } from "@/types/speedcamera";
import type { MapBounds } from "@/types/waze";

interface UseSpeedCamerasOptions {
  bounds: MapBounds | null;
  refreshInterval?: number; // milliseconds
  debounceMs?: number;
  minMovementThreshold?: number;
  enabled?: boolean;
  minZoomLevel?: number; // minimum zoom level to fetch (prevents overloading servers when zoomed out)
}

// Calculate the overlap between two bounds (0 = no overlap, 1 = identical)
function calculateBoundsOverlap(a: MapBounds, b: MapBounds): number {
  const intersectLeft = Math.max(a.west, b.west);
  const intersectRight = Math.min(a.east, b.east);
  const intersectBottom = Math.max(a.south, b.south);
  const intersectTop = Math.min(a.north, b.north);

  if (intersectLeft >= intersectRight || intersectBottom >= intersectTop) {
    return 0;
  }

  const intersectArea = (intersectRight - intersectLeft) * (intersectTop - intersectBottom);
  const aArea = (a.east - a.west) * (a.north - a.south);
  const bArea = (b.east - b.west) * (b.north - b.south);
  
  const smallerArea = Math.min(aArea, bArea);
  return smallerArea > 0 ? intersectArea / smallerArea : 0;
}

export function useSpeedCameras({
  bounds,
  refreshInterval = 300000, // 5 minutes (cameras don't change often)
  debounceMs = 400, // 400ms - slightly longer than Waze since cameras are less urgent
  minMovementThreshold = 0.25, // Fetch if viewport changed by 25%+
  enabled = true,
  minZoomLevel = 10, // Don't fetch when zoomed out past city level to avoid overloading servers
}: UseSpeedCamerasOptions) {
  const [cameras, setCameras] = useState<SpeedCamera[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastFetchedBounds = useRef<MapBounds | null>(null);
  const lastBounds = useRef<MapBounds | null>(null);
  
  // Rate limiting state
  const requestTimestamps = useRef<number[]>([]);
  const backoffUntil = useRef<number>(0);
  const consecutiveErrors = useRef<number>(0);

  // Check if we can make a request
  const canMakeRequest = useCallback((): boolean => {
    const now = Date.now();
    
    if (now < backoffUntil.current) {
      return false;
    }
    
    // Clean up old timestamps (older than 1 minute)
    requestTimestamps.current = requestTimestamps.current.filter(
      (ts) => now - ts < 60000
    );
    
    // Allow max 6 requests per minute (server caching handles dedup)
    return requestTimestamps.current.length < 6;
  }, []);

  const recordRequest = useCallback(() => {
    requestTimestamps.current.push(Date.now());
  }, []);

  const handleRateLimitError = useCallback(() => {
    consecutiveErrors.current += 1;
    const backoffTime = Math.min(60000 * Math.pow(2, consecutiveErrors.current - 1), 300000);
    backoffUntil.current = Date.now() + backoffTime;
    console.warn(`OSM rate limited. Backing off for ${backoffTime / 1000}s`);
  }, []);

  const handleSuccess = useCallback(() => {
    consecutiveErrors.current = 0;
  }, []);

  const hasSignificantMovement = useCallback(
    (newBounds: MapBounds): boolean => {
      if (!lastFetchedBounds.current) return true;
      
      const overlap = calculateBoundsOverlap(lastFetchedBounds.current, newBounds);
      // If overlap is at or below (1 - threshold), we've moved enough
      return overlap <= (1 - minMovementThreshold);
    },
    [minMovementThreshold]
  );

  const fetchCameras = useCallback(
    async (currentBounds: MapBounds, force: boolean = false) => {
      if (!enabled) return;
      
      // Check zoom level - don't fetch if zoomed out too far
      if (currentBounds.zoom !== undefined && currentBounds.zoom < minZoomLevel) {
        console.log(`OSM request skipped: zoom level ${currentBounds.zoom.toFixed(1)} below minimum ${minZoomLevel}`);
        return;
      }
      
      if (!canMakeRequest()) {
        console.log("OSM request skipped: rate limit");
        return;
      }

      if (!force && !hasSignificantMovement(currentBounds)) {
        console.log("OSM request skipped: insufficient movement");
        return;
      }

      try {
        setLoading(true);
        setError(null);
        recordRequest();

        const params = new URLSearchParams({
          left: currentBounds.west.toString(),
          right: currentBounds.east.toString(),
          bottom: currentBounds.south.toString(),
          top: currentBounds.north.toString(),
        });

        const response = await fetch(`/api/speedcameras?${params}`);

        if (response.status === 429) {
          handleRateLimitError();
          throw new Error("Rate limited");
        }

        if (!response.ok) {
          throw new Error("Failed to fetch speed cameras");
        }

        const data = await response.json();
        setCameras(data.cameras || []);
        lastFetchedBounds.current = currentBounds;
        handleSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [enabled, canMakeRequest, hasSignificantMovement, recordRequest, handleRateLimitError, handleSuccess, minZoomLevel]
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

  // Periodic refresh
  useEffect(() => {
    if (!enabled) return;
    
    const interval = setInterval(() => {
      if (lastBounds.current) {
        fetchCameras(lastBounds.current, true);
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval, fetchCameras, enabled]);

  return {
    cameras,
    loading,
    error,
    refetch: () => bounds && fetchCameras(bounds, true),
  };
}

