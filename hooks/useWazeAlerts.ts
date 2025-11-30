"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { WazeAlert, MapBounds } from "@/types/waze";

interface UseWazeAlertsOptions {
  bounds: MapBounds | null;
  refreshInterval?: number; // milliseconds
  debounceMs?: number;
  bufferMultiplier?: number; // How much larger to fetch than viewport (e.g., 2 = 2x viewport size)
  cacheTTL?: number; // How long cached tiles are valid (milliseconds)
  maxRequestsPerMinute?: number;
  minZoomLevel?: number; // minimum zoom level to fetch (prevents overloading servers when zoomed out)
}

// Cached tile with bounds, alerts, and timestamp
interface CachedTile {
  bounds: MapBounds;
  alerts: WazeAlert[];
  fetchedAt: number;
}

// Expand bounds by a multiplier (e.g., 2x means 50% padding on each side)
function expandBounds(bounds: MapBounds, multiplier: number): MapBounds {
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;
  
  // Calculate padding (multiplier of 2 means we add 50% on each side = 2x total area)
  const paddingFactor = (multiplier - 1) / 2;
  const horizontalPadding = width * paddingFactor;
  const verticalPadding = height * paddingFactor;
  
  return {
    west: bounds.west - horizontalPadding,
    east: bounds.east + horizontalPadding,
    south: bounds.south - verticalPadding,
    north: bounds.north + verticalPadding,
    zoom: bounds.zoom,
  };
}

// Check if viewport is fully contained within fetched bounds
function isViewportContained(viewport: MapBounds, fetchedBounds: MapBounds): boolean {
  return (
    viewport.west >= fetchedBounds.west &&
    viewport.east <= fetchedBounds.east &&
    viewport.south >= fetchedBounds.south &&
    viewport.north <= fetchedBounds.north
  );
}

// Check if two bounds overlap at all
function boundsOverlap(a: MapBounds, b: MapBounds): boolean {
  return !(
    a.east < b.west ||
    a.west > b.east ||
    a.north < b.south ||
    a.south > b.north
  );
}

export function useWazeAlerts({
  bounds,
  refreshInterval = 30000, // 30 seconds - safety-critical data needs frequent updates
  debounceMs = 250, // 250ms - snappy response, server caching handles the rest
  bufferMultiplier = 2.5, // Fetch 2.5x the viewport size (allows panning/zooming without new requests)
  cacheTTL = 60000, // 60 seconds - cached tiles are valid for this long
  maxRequestsPerMinute = 15, // Allow more requests for safety-critical updates
  minZoomLevel = 10, // Don't fetch when zoomed out past city level to avoid overloading servers
}: UseWazeAlertsOptions) {
  const [alerts, setAlerts] = useState<WazeAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const tileCache = useRef<CachedTile[]>([]); // Cache of fetched tiles with TTL
  const lastBounds = useRef<MapBounds | null>(null);
  
  // Rate limiting state
  const requestTimestamps = useRef<number[]>([]);
  const backoffUntil = useRef<number>(0);
  const consecutiveErrors = useRef<number>(0);

  // Clean up expired tiles from cache
  const cleanExpiredTiles = useCallback(() => {
    const now = Date.now();
    tileCache.current = tileCache.current.filter(
      (tile) => now - tile.fetchedAt < cacheTTL
    );
  }, [cacheTTL]);

  // Find a valid cached tile that contains the viewport
  const findCachedTile = useCallback(
    (viewport: MapBounds): CachedTile | null => {
      cleanExpiredTiles();
      
      // Find a tile that fully contains the viewport
      return tileCache.current.find((tile) => 
        isViewportContained(viewport, tile.bounds)
      ) || null;
    },
    [cleanExpiredTiles]
  );

  // Get all alerts from cached tiles that overlap with viewport
  const getAlertsFromCache = useCallback(
    (viewport: MapBounds): WazeAlert[] => {
      cleanExpiredTiles();
      
      // Find all tiles that overlap with viewport
      const overlappingTiles = tileCache.current.filter((tile) =>
        boundsOverlap(viewport, tile.bounds)
      );
      
      // Merge alerts, deduplicating by ID
      const alertMap = new Map<string, WazeAlert>();
      for (const tile of overlappingTiles) {
        for (const alert of tile.alerts) {
          if (!alertMap.has(alert.uuid)) {
            alertMap.set(alert.uuid, alert);
          }
        }
      }
      
      return Array.from(alertMap.values());
    },
    [cleanExpiredTiles]
  );

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

  const fetchAlerts = useCallback(
    async (viewportBounds: MapBounds, force: boolean = false) => {
      // Check zoom level - don't fetch if zoomed out too far
      if (viewportBounds.zoom !== undefined && viewportBounds.zoom < minZoomLevel) {
        console.log(`Waze request skipped: zoom level ${viewportBounds.zoom.toFixed(1)} below minimum ${minZoomLevel}`);
        return;
      }

      // Check if we have valid cached data (unless forced)
      if (!force) {
        const cachedTile = findCachedTile(viewportBounds);
        if (cachedTile) {
          const ageSeconds = Math.round((Date.now() - cachedTile.fetchedAt) / 1000);
          console.log(`Waze using cached tile (${ageSeconds}s old, ${cachedTile.alerts.length} alerts)`);
          // Update alerts from cache (merge overlapping tiles)
          setAlerts(getAlertsFromCache(viewportBounds));
          return;
        }
      }

      // Check rate limiting
      if (!canMakeRequest()) {
        console.log("Waze request skipped: rate limit");
        return;
      }

      // Expand bounds to fetch a larger area than the viewport
      const expandedBounds = expandBounds(viewportBounds, bufferMultiplier);

      try {
        setLoading(true);
        setError(null);
        recordRequest();

        const params = new URLSearchParams({
          left: expandedBounds.west.toString(),
          right: expandedBounds.east.toString(),
          bottom: expandedBounds.south.toString(),
          top: expandedBounds.north.toString(),
        });

        console.log(`Waze fetching ${bufferMultiplier}x viewport area for smoother panning`);
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
        const fetchedAlerts: WazeAlert[] = data.alerts || [];
        
        // Add to tile cache
        cleanExpiredTiles();
        tileCache.current.push({
          bounds: expandedBounds,
          alerts: fetchedAlerts,
          fetchedAt: Date.now(),
        });
        
        // Limit cache size (keep last 10 tiles)
        if (tileCache.current.length > 10) {
          tileCache.current = tileCache.current.slice(-10);
        }
        
        // Update alerts (merge from all overlapping cached tiles)
        setAlerts(getAlertsFromCache(viewportBounds));
        handleSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [canMakeRequest, findCachedTile, getAlertsFromCache, cleanExpiredTiles, recordRequest, handleRateLimitError, handleSuccess, minZoomLevel, bufferMultiplier]
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

  // Get current cache state for dev visualization
  const getCachedTileBounds = useCallback((): Array<{ bounds: MapBounds; ageMs: number }> => {
    cleanExpiredTiles();
    const now = Date.now();
    return tileCache.current.map((tile) => ({
      bounds: tile.bounds,
      ageMs: now - tile.fetchedAt,
    }));
  }, [cleanExpiredTiles]);

  return {
    alerts,
    loading,
    error,
    refetch: () => bounds && fetchAlerts(bounds, true),
    // Dev mode helpers
    getCachedTileBounds,
  };
}
