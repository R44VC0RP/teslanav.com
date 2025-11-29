"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { WazeAlert, MapBounds } from "@/types/waze";

interface UseWazeAlertsOptions {
  bounds: MapBounds | null;
  refreshInterval?: number; // milliseconds
  debounceMs?: number;
  minMovementThreshold?: number; // percentage of viewport that must change (0-1)
  maxRequestsPerMinute?: number;
}

// Calculate the overlap between two bounds (0 = no overlap, 1 = identical)
function calculateBoundsOverlap(a: MapBounds, b: MapBounds): number {
  const intersectLeft = Math.max(a.west, b.west);
  const intersectRight = Math.min(a.east, b.east);
  const intersectBottom = Math.max(a.south, b.south);
  const intersectTop = Math.min(a.north, b.north);

  if (intersectLeft >= intersectRight || intersectBottom >= intersectTop) {
    return 0; // No overlap
  }

  const intersectArea = (intersectRight - intersectLeft) * (intersectTop - intersectBottom);
  const aArea = (a.east - a.west) * (a.north - a.south);
  const bArea = (b.east - b.west) * (b.north - b.south);
  
  // Return overlap as percentage of the smaller bounds
  const smallerArea = Math.min(aArea, bArea);
  return smallerArea > 0 ? intersectArea / smallerArea : 0;
}

export function useWazeAlerts({
  bounds,
  refreshInterval = 60000, // 60 seconds (increased from 30s)
  debounceMs = 2000, // 2 seconds (increased from 500ms to let user finish panning)
  minMovementThreshold = 0.3, // Only fetch if viewport changed by 30%+ (70% or less overlap)
  maxRequestsPerMinute = 4, // Max 4 requests per minute (1 every 15 seconds average)
}: UseWazeAlertsOptions) {
  const [alerts, setAlerts] = useState<WazeAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastFetchedBounds = useRef<MapBounds | null>(null);
  const lastBounds = useRef<MapBounds | null>(null);
  
  // Rate limiting state
  const requestTimestamps = useRef<number[]>([]);
  const backoffUntil = useRef<number>(0);
  const consecutiveErrors = useRef<number>(0);

  // Check if we can make a request (rate limiting)
  const canMakeRequest = useCallback((): boolean => {
    const now = Date.now();
    
    // Check if we're in a backoff period
    if (now < backoffUntil.current) {
      return false;
    }
    
    // Clean up old timestamps (older than 1 minute)
    requestTimestamps.current = requestTimestamps.current.filter(
      (ts) => now - ts < 60000
    );
    
    // Check if we've exceeded the rate limit
    return requestTimestamps.current.length < maxRequestsPerMinute;
  }, [maxRequestsPerMinute]);

  // Record a request timestamp
  const recordRequest = useCallback(() => {
    requestTimestamps.current.push(Date.now());
  }, []);

  // Handle rate limit errors with exponential backoff
  const handleRateLimitError = useCallback(() => {
    consecutiveErrors.current += 1;
    // Exponential backoff: 30s, 60s, 120s, 240s (max 4 min)
    const backoffTime = Math.min(30000 * Math.pow(2, consecutiveErrors.current - 1), 240000);
    backoffUntil.current = Date.now() + backoffTime;
    console.warn(`Waze rate limited. Backing off for ${backoffTime / 1000}s`);
  }, []);

  // Reset error count on successful request
  const handleSuccess = useCallback(() => {
    consecutiveErrors.current = 0;
  }, []);

  // Check if bounds have changed enough to warrant a new fetch
  const hasSignificantMovement = useCallback(
    (newBounds: MapBounds): boolean => {
      if (!lastFetchedBounds.current) return true;
      
      const overlap = calculateBoundsOverlap(lastFetchedBounds.current, newBounds);
      // If overlap is less than (1 - threshold), we've moved enough
      return overlap < (1 - minMovementThreshold);
    },
    [minMovementThreshold]
  );

  const fetchAlerts = useCallback(
    async (currentBounds: MapBounds, force: boolean = false) => {
      // Check rate limiting
      if (!canMakeRequest()) {
        console.log("Waze request skipped: rate limit");
        return;
      }

      // Check if bounds changed enough (unless forced)
      if (!force && !hasSignificantMovement(currentBounds)) {
        console.log("Waze request skipped: insufficient movement");
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

        const response = await fetch(`/api/waze?${params}`);

        if (response.status === 429) {
          // Rate limited by server
          handleRateLimitError();
          throw new Error("Rate limited");
        }

        if (!response.ok) {
          throw new Error("Failed to fetch Waze alerts");
        }

        const data = await response.json();
        setAlerts(data.alerts || []);
        lastFetchedBounds.current = currentBounds;
        handleSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [canMakeRequest, hasSignificantMovement, recordRequest, handleRateLimitError, handleSuccess]
  );

  // Debounced fetch when bounds change
  useEffect(() => {
    if (!bounds) return;

    // Clear existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Store the latest bounds for periodic refresh
    lastBounds.current = bounds;

    // Debounce the fetch - only fetch if movement is significant
    debounceTimer.current = setTimeout(() => {
      fetchAlerts(bounds);
    }, debounceMs);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [bounds, debounceMs, fetchAlerts]);

  // Periodic refresh - uses force=true to bypass movement check
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastBounds.current) {
        fetchAlerts(lastBounds.current, true);
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval, fetchAlerts]);

  return {
    alerts,
    loading,
    error,
    refetch: () => bounds && fetchAlerts(bounds, true),
  };
}
