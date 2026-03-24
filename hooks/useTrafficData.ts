"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MapBounds } from "@/types/waze";
import type { TrafficIncident, TrafficSegment } from "@/types/traffic";

interface UseTrafficDataOptions {
  bounds: MapBounds | null;
  refreshInterval?: number; // milliseconds
  debounceMs?: number;
  minZoomLevel?: number;
}

interface CachedTrafficTile {
  bounds: MapBounds;
  incidents: TrafficIncident[];
  segments: TrafficSegment[];
  fetchedAt: number;
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

// Expand bounds by a multiplier for prefetching
function expandBounds(bounds: MapBounds, multiplier: number): MapBounds {
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;
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

export function useTrafficData({
  bounds,
  refreshInterval = 120000, // 2 minutes for real-time incidents
  debounceMs = 250,
  minZoomLevel = 10,
}: UseTrafficDataOptions) {
  const [incidents, setIncidents] = useState<TrafficIncident[]>([]);
  const [segments, setSegments] = useState<TrafficSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const tileCache = useRef<CachedTrafficTile[]>([]);
  const lastBounds = useRef<MapBounds | null>(null);
  const requestTimestamps = useRef<number[]>([]);

  // Clean up expired tiles from cache
  const cleanExpiredTiles = useCallback(() => {
    const now = Date.now();
    const incidentsTTL = 120000; // 2 min for incidents
    const segmentsTTL = 3600000; // 1 hour for segments

    tileCache.current = tileCache.current.filter((tile) => {
      const age = now - tile.fetchedAt;
      // Keep if it has valid incidents or segments
      return (
        (tile.incidents.length > 0 && age < incidentsTTL) ||
        (tile.segments.length > 0 && age < segmentsTTL)
      );
    });
  }, []);

  // Find a valid cached tile that contains the viewport
  const findCachedTile = useCallback(
    (viewport: MapBounds): CachedTrafficTile | null => {
      cleanExpiredTiles();
      return tileCache.current.find((tile) => isViewportContained(viewport, tile.bounds)) || null;
    },
    [cleanExpiredTiles]
  );

  // Get all data from cached tiles that overlap with viewport
  const getDataFromCache = useCallback(
    (viewport: MapBounds): { incidents: TrafficIncident[]; segments: TrafficSegment[] } => {
      cleanExpiredTiles();

      const overlappingTiles = tileCache.current.filter((tile) => boundsOverlap(viewport, tile.bounds));

      // Deduplicate by ID
      const incidentMap = new Map<string, TrafficIncident>();
      const segmentMap = new Map<string, TrafficSegment>();

      for (const tile of overlappingTiles) {
        for (const incident of tile.incidents) {
          if (!incidentMap.has(incident.id)) {
            incidentMap.set(incident.id, incident);
          }
        }
        for (const segment of tile.segments) {
          if (!segmentMap.has(segment.id)) {
            segmentMap.set(segment.id, segment);
          }
        }
      }

      return {
        incidents: Array.from(incidentMap.values()),
        segments: Array.from(segmentMap.values()),
      };
    },
    [cleanExpiredTiles]
  );

  // Rate limiting helper
  const canMakeRequest = useCallback((): boolean => {
    const now = Date.now();
    requestTimestamps.current = requestTimestamps.current.filter((ts) => now - ts < 60000);
    return requestTimestamps.current.length < 10; // Max 10 requests per minute
  }, []);

  const recordRequest = useCallback(() => {
    requestTimestamps.current.push(Date.now());
  }, []);

  const fetchTrafficData = useCallback(
    async (viewportBounds: MapBounds, force: boolean = false) => {
      // Check zoom level
      if (viewportBounds.zoom !== undefined && viewportBounds.zoom < minZoomLevel) {
        console.log(
          `Traffic data skipped: zoom level ${viewportBounds.zoom.toFixed(1)} below minimum ${minZoomLevel}`
        );
        return;
      }

      // Check cache
      if (!force) {
        const cachedTile = findCachedTile(viewportBounds);
        if (cachedTile) {
          console.log(`Traffic using cached data`);
          const data = getDataFromCache(viewportBounds);
          setIncidents(data.incidents);
          setSegments(data.segments);
          return;
        }
      }

      // Check rate limiting
      if (!canMakeRequest()) {
        console.log("Traffic request skipped: rate limit");
        return;
      }

      // Expand bounds for prefetching
      const expandedBounds = expandBounds(viewportBounds, 2);

      try {
        setLoading(true);
        setError(null);
        recordRequest();

        // Fetch both incident and segment data in parallel
        const [incidentsResponse, segmentsResponse] = await Promise.all([
          fetch(
            `/api/tomtom?left=${expandedBounds.west}&right=${expandedBounds.east}&bottom=${expandedBounds.south}&top=${expandedBounds.north}`
          ),
          fetch(
            `/api/opentraffic?left=${expandedBounds.west}&right=${expandedBounds.east}&bottom=${expandedBounds.south}&top=${expandedBounds.north}`
          ),
        ]);

        if (!incidentsResponse.ok || !segmentsResponse.ok) {
          throw new Error("Failed to fetch traffic data");
        }

        const incidentsData = await incidentsResponse.json();
        const segmentsData = await segmentsResponse.json();

        const fetchedIncidents: TrafficIncident[] = incidentsData.incidents || [];
        const fetchedSegments: TrafficSegment[] = segmentsData.segments || [];

        // Add to cache
        cleanExpiredTiles();
        tileCache.current.push({
          bounds: expandedBounds,
          incidents: fetchedIncidents,
          segments: fetchedSegments,
          fetchedAt: Date.now(),
        });

        // Limit cache size
        if (tileCache.current.length > 5) {
          tileCache.current = tileCache.current.slice(-5);
        }

        // Update state with merged data
        const data = getDataFromCache(viewportBounds);
        setIncidents(data.incidents);
        setSegments(data.segments);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        console.error("Traffic data fetch error:", err);
      } finally {
        setLoading(false);
      }
    },
    [canMakeRequest, findCachedTile, getDataFromCache, cleanExpiredTiles, recordRequest, minZoomLevel]
  );

  // Debounced fetch when bounds change
  useEffect(() => {
    if (!bounds) return;

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    lastBounds.current = bounds;

    debounceTimer.current = setTimeout(() => {
      fetchTrafficData(bounds);
    }, debounceMs);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [bounds, debounceMs, fetchTrafficData]);

  // Periodic refresh
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastBounds.current) {
        fetchTrafficData(lastBounds.current, true);
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval, fetchTrafficData]);

  return {
    incidents,
    segments,
    loading,
    error,
    refetch: () => bounds && fetchTrafficData(bounds, true),
  };
}
