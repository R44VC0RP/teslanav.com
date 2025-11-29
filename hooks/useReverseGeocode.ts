"use client";

import { useState, useEffect, useRef } from "react";

interface ReverseGeocodeResult {
  placeName: string | null;
  neighborhood: string | null;
  locality: string | null;
  loading: boolean;
  error: string | null;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export function useReverseGeocode(
  latitude: number | null,
  longitude: number | null
): ReverseGeocodeResult {
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState<string | null>(null);
  const [locality, setLocality] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track last fetched coords to avoid duplicate requests
  const lastCoords = useRef<string | null>(null);

  useEffect(() => {
    if (!latitude || !longitude || !MAPBOX_TOKEN) return;

    // Round to 3 decimal places to avoid too many API calls for small movements
    const roundedLat = Math.round(latitude * 1000) / 1000;
    const roundedLng = Math.round(longitude * 1000) / 1000;
    const coordKey = `${roundedLat},${roundedLng}`;

    // Skip if we already fetched for these coords
    if (lastCoords.current === coordKey) return;
    lastCoords.current = coordKey;

    const fetchPlaceName = async () => {
      setLoading(true);
      setError(null);

      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_TOKEN}&types=neighborhood,locality,place&limit=1`;
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error("Failed to fetch location name");
        }

        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
          const feature = data.features[0];
          
          // Extract different levels of place names
          let neighborhoodName: string | null = null;
          let localityName: string | null = null;
          let placeName: string | null = null;

          // The main result
          if (feature.place_type.includes("neighborhood")) {
            neighborhoodName = feature.text;
          } else if (feature.place_type.includes("locality")) {
            localityName = feature.text;
          } else if (feature.place_type.includes("place")) {
            placeName = feature.text;
          }

          // Also check context for additional info
          if (feature.context) {
            for (const ctx of feature.context) {
              if (ctx.id.startsWith("neighborhood") && !neighborhoodName) {
                neighborhoodName = ctx.text;
              } else if (ctx.id.startsWith("locality") && !localityName) {
                localityName = ctx.text;
              } else if (ctx.id.startsWith("place") && !placeName) {
                placeName = ctx.text;
              }
            }
          }

          setNeighborhood(neighborhoodName);
          setLocality(localityName);
          
          // Set the best available name
          const bestName = neighborhoodName || localityName || placeName || feature.place_name?.split(",")[0];
          setPlaceName(bestName);
        } else {
          setPlaceName(null);
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

