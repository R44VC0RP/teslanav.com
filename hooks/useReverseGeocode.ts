"use client";

import { useState, useEffect, useRef } from "react";

interface ReverseGeocodeResult {
  placeName: string | null;
  neighborhood: string | null;
  locality: string | null;
  loading: boolean;
  error: string | null;
}

// Minimum time between API calls (30 seconds)
const MIN_FETCH_INTERVAL_MS = 30000;

// In-memory cache for the session (survives re-renders but not page refresh)
const locationCache = new Map<string, { placeName: string; neighborhood: string | null; locality: string | null }>();

export function useReverseGeocode(
  latitude: number | null,
  longitude: number | null
): ReverseGeocodeResult {
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState<string | null>(null);
  const [locality, setLocality] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track last fetched coords and time to avoid duplicate/frequent requests
  const lastCoords = useRef<string | null>(null);
  const lastFetchTime = useRef<number>(0);

  useEffect(() => {
    if (!latitude || !longitude) return;

    // Round to 2 decimal places (~1.1km grid) to reduce API calls
    // This means we only fetch a new location name every ~1km of movement
    const roundedLat = Math.round(latitude * 100) / 100;
    const roundedLng = Math.round(longitude * 100) / 100;
    const coordKey = `${roundedLat},${roundedLng}`;

    // Skip if we already fetched for these coords (or close enough)
    if (lastCoords.current === coordKey) return;

    // Check in-memory cache first
    const cached = locationCache.get(coordKey);
    if (cached) {
      lastCoords.current = coordKey;
      setPlaceName(cached.placeName);
      setNeighborhood(cached.neighborhood);
      setLocality(cached.locality);
      return;
    }

    // Time-based throttle: don't fetch more than once per 30 seconds
    const now = Date.now();
    if (now - lastFetchTime.current < MIN_FETCH_INTERVAL_MS) {
      return;
    }

    lastCoords.current = coordKey;
    lastFetchTime.current = now;

    const fetchPlaceName = async () => {
      setLoading(true);
      setError(null);

      try {
        // Use our cached API route instead of calling Mapbox directly
        const response = await fetch(
          `/api/geocode/reverse?lng=${longitude}&lat=${latitude}`
        );
        
        if (!response.ok) {
          throw new Error("Failed to fetch location name");
        }

        const data = await response.json();
        
        // Extract a clean neighborhood/locality name from the full place name
        const fullName = data.placeName || "";
        const parts = fullName.split(",").map((p: string) => p.trim());
        
        // Usually: "Street Address, Neighborhood, City, State ZIP, Country"
        // We want the neighborhood or city
        const neighborhoodName = parts.length > 2 ? parts[1] : null;
        const localityName = parts.length > 3 ? parts[2] : parts.length > 1 ? parts[1] : null;
        const displayName = neighborhoodName || localityName || parts[0] || null;

        setNeighborhood(neighborhoodName);
        setLocality(localityName);
        setPlaceName(displayName);

        // Cache in memory for this session
        if (displayName) {
          locationCache.set(coordKey, {
            placeName: displayName,
            neighborhood: neighborhoodName,
            locality: localityName,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchPlaceName();
  }, [latitude, longitude]);

  return { placeName, neighborhood, locality, loading, error };
}

