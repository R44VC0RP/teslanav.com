import { useState, useCallback, useEffect, useRef } from "react";
import type { MapBounds } from "@/types/waze";
import type { Supercharger } from "@/types/supercharger";

interface UseSuperchargers {
  superchargers: Supercharger[];
  isLoading: boolean;
  error: string | null;
  fetchSuperchargers: (bounds: MapBounds) => Promise<void>;
}

export function useSuperchargers(): UseSuperchargers {
  const [superchargers, setSuperchargers] = useState<Supercharger[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, Supercharger[]>>(new Map());

  const fetchSuperchargers = useCallback(async (bounds: MapBounds) => {
    try {
      setIsLoading(true);
      setError(null);

      // Create cache key from bounds
      const cacheKey = `${bounds.minLat}-${bounds.minLng}-${bounds.maxLat}-${bounds.maxLng}`;

      // Check cache
      if (cacheRef.current.has(cacheKey)) {
        setSuperchargers(cacheRef.current.get(cacheKey)!);
        setIsLoading(false);
        return;
      }

      // Fetch from API
      const response = await fetch(
        `/api/superchargers?minLat=${bounds.minLat}&minLng=${bounds.minLng}&maxLat=${bounds.maxLat}&maxLng=${bounds.maxLng}`,
        { method: "GET", credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch superchargers");
      }

      const data = await response.json();
      const chargers = data.superchargers || [];

      // Cache results
      cacheRef.current.set(cacheKey, chargers);
      setSuperchargers(chargers);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    superchargers,
    isLoading,
    error,
    fetchSuperchargers,
  };
}
