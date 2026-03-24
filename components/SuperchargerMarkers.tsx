"use client";

import { useEffect, useState } from "react";
import type mapboxgl from "mapbox-gl";
import type { MapBounds } from "@/types/waze";
import type { Supercharger } from "@/types/supercharger";
import { useSuperchargers } from "@/hooks/useSuperchargers";

interface SuperchargerMarkersProps {
  map: mapboxgl.Map | null;
  bounds: MapBounds | null;
  isDarkMode?: boolean;
  onSuperchargerClick?: (supercharger: Supercharger) => void;
  showSuperchargers?: boolean;
}

export function useSuperchargerMarkers({
  map,
  bounds,
  isDarkMode = false,
  onSuperchargerClick,
  showSuperchargers = true,
}: SuperchargerMarkersProps) {
  const { superchargers, isLoading, error, fetchSuperchargers } = useSuperchargers();
  const [markers, setMarkers] = useState<Map<string, mapboxgl.Marker>>(new Map());

  // Fetch superchargers when bounds change
  useEffect(() => {
    if (!bounds || !showSuperchargers) {
      return;
    }
    fetchSuperchargers(bounds);
  }, [bounds, showSuperchargers, fetchSuperchargers]);

  // Update markers when superchargers change
  useEffect(() => {
    if (!map || !showSuperchargers) {
      // Clear all markers
      markers.forEach((marker) => marker.remove());
      setMarkers(new Map());
      return;
    }

    const newMarkers = new Map<string, mapboxgl.Marker>();

    // Add markers for each supercharger
    superchargers.forEach((supercharger) => {
      const existingMarker = markers.get(supercharger.id);

      if (!existingMarker) {
        // Create marker element
        const el = document.createElement("div");
        el.className = "supercharger-marker";
        el.style.cssText = `
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.2s;
        `;

        // SVG icon for supercharger
        el.innerHTML = `
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="14" fill="${isDarkMode ? "#fff" : "#000"}" opacity="0.9"/>
            <path d="M16 6v10m-5-5h10" stroke="${isDarkMode ? "#000" : "#fff"}" stroke-width="2" stroke-linecap="round"/>
          </svg>
        `;

        el.addEventListener("mouseenter", () => {
          el.style.transform = "scale(1.2)";
        });

        el.addEventListener("mouseleave", () => {
          el.style.transform = "scale(1)";
        });

        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSuperchargerClick?.(supercharger);
        });

        const marker = new (window as any).mapboxgl.Marker(el)
          .setLngLat([supercharger.longitude, supercharger.latitude])
          .addTo(map);

        newMarkers.set(supercharger.id, marker);
      } else {
        newMarkers.set(supercharger.id, existingMarker);
      }
    });

    // Remove markers that are no longer in the list
    markers.forEach((marker, id) => {
      if (!newMarkers.has(id)) {
        marker.remove();
      }
    });

    setMarkers(newMarkers);
  }, [map, superchargers, isDarkMode, showSuperchargers, onSuperchargerClick, markers]);

  return {
    superchargers,
    isLoading,
    error,
    markers,
  };
}
