"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { WazeAlert, MapBounds } from "@/types/waze";
import posthog from "posthog-js";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

interface MapProps {
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  isDarkMode?: boolean;
  alerts?: WazeAlert[];
  onBoundsChange?: (bounds: MapBounds) => void;
  onCenteredChange?: (isCentered: boolean) => void;
  userLocation?: { 
    latitude: number; 
    longitude: number; 
    heading?: number | null;
    effectiveHeading?: number | null;
  } | null;
  followMode?: boolean;
  showTraffic?: boolean;
  useSatellite?: boolean;
  showAvatarPulse?: boolean;
}

export interface MapRef {
  recenter: (lng: number, lat: number) => void;
  setFollowMode: (enabled: boolean) => void;
  resetNorth: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

const ALERT_COLORS: Record<string, string> = {
  POLICE: "#3b82f6", // blue
  ACCIDENT: "#ef4444", // red
  HAZARD: "#f59e0b", // amber
  ROAD_CLOSED: "#6b7280", // gray
  JAM: "#8b5cf6", // purple
};

const ALERT_ICONS: Record<string, string> = {
  POLICE: "🚔",
  ACCIDENT: "🚨",
  HAZARD: "⚠️",
  ROAD_CLOSED: "🚧",
  JAM: "🚗",
};

// Severity order for clustering (higher = more severe)
const ALERT_SEVERITY: Record<string, number> = {
  ACCIDENT: 4,
  ROAD_CLOSED: 3,
  HAZARD: 2,
  POLICE: 1,
  JAM: 0,
};

// Cluster alerts that are within a certain distance
interface AlertCluster {
  alerts: WazeAlert[];
  center: { x: number; y: number };
  mostSevereType: string;
}

function clusterAlerts(
  alerts: WazeAlert[],
  clusterRadius: number = 0.002 // ~200m at equator
): AlertCluster[] {
  if (alerts.length === 0) return [];

  const clusters: AlertCluster[] = [];
  const used = new Set<string>();

  for (const alert of alerts) {
    if (used.has(alert.uuid)) continue;

    // Find all alerts within radius
    const nearby = alerts.filter((other) => {
      if (used.has(other.uuid)) return false;
      const dx = alert.location.x - other.location.x;
      const dy = alert.location.y - other.location.y;
      return Math.sqrt(dx * dx + dy * dy) < clusterRadius;
    });

    // Mark all as used
    nearby.forEach((a) => used.add(a.uuid));

    // Calculate center
    const centerX = nearby.reduce((sum, a) => sum + a.location.x, 0) / nearby.length;
    const centerY = nearby.reduce((sum, a) => sum + a.location.y, 0) / nearby.length;

    // Find most severe type
    const mostSevereType = nearby.reduce((most, a) => {
      const currentSeverity = ALERT_SEVERITY[a.type] ?? 0;
      const mostSeverity = ALERT_SEVERITY[most] ?? 0;
      return currentSeverity > mostSeverity ? a.type : most;
    }, nearby[0].type);

    clusters.push({
      alerts: nearby,
      center: { x: centerX, y: centerY },
      mostSevereType,
    });
  }

  return clusters;
}

// Linear interpolation
function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

// Normalize angle to 0-360 range
function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

// Get shortest angle difference for smooth rotation
function getAngleDiff(from: number, to: number): number {
  const diff = normalizeAngle(to - from);
  return diff > 180 ? diff - 360 : diff;
}

export const Map = forwardRef<MapRef, MapProps>(function Map(
  {
    center = [-122.4194, 37.7749],
    zoom = 13,
    isDarkMode = false,
    alerts = [],
    onBoundsChange,
    onCenteredChange,
    userLocation,
    followMode = false,
    showTraffic = false,
    useSatellite = false,
    showAvatarPulse = true,
  },
  ref
) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const userMarkerElRef = useRef<HTMLDivElement | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const initialCenterSet = useRef(false);
  const isFollowMode = useRef(followMode);
  
  // Track if we should auto-center (user hasn't panned away)
  const isAutoCentering = useRef(true);
  const userInteractingRef = useRef(false);
  
  // Animation state for smooth interpolation
  const animationRef = useRef<number | null>(null);
  const currentPositionRef = useRef<{ lng: number; lat: number } | null>(null);
  const targetPositionRef = useRef<{ lng: number; lat: number } | null>(null);
  const currentHeadingRef = useRef<number>(0);
  const targetHeadingRef = useRef<number>(0);
  
  // Animation speed config
  const POSITION_LERP_SPEED = 0.1; // How fast to interpolate position (0-1, higher = faster)
  const HEADING_LERP_SPEED = 0.15; // How fast to interpolate heading
  const CAMERA_FOLLOW_SPEED = 0.08; // How fast camera follows

  // Update follow mode ref when prop changes
  useEffect(() => {
    isFollowMode.current = followMode;
    
    if (map.current && mapLoaded) {
      if (followMode) {
        // Enable rotation when in follow mode
        map.current.dragRotate.enable();
        map.current.touchZoomRotate.enableRotation();
      } else {
        // Reset to north and disable rotation
        map.current.easeTo({ bearing: 0, duration: 500 });
        map.current.dragRotate.disable();
        map.current.touchZoomRotate.disableRotation();
      }
    }
  }, [followMode, mapLoaded]);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    recenter: (lng: number, lat: number) => {
      // Re-enable auto-centering when user clicks recenter
      isAutoCentering.current = true;
      onCenteredChange?.(true);
      
      map.current?.flyTo({
        center: [lng, lat],
        zoom: map.current.getZoom(),
        duration: 800,
        essential: true,
      });
    },
    setFollowMode: (enabled: boolean) => {
      isFollowMode.current = enabled;
      if (map.current) {
        if (enabled) {
          map.current.dragRotate.enable();
          map.current.touchZoomRotate.enableRotation();
        } else {
          map.current.easeTo({ bearing: 0, duration: 500 });
          map.current.dragRotate.disable();
          map.current.touchZoomRotate.disableRotation();
        }
      }
    },
    resetNorth: () => {
      map.current?.easeTo({ bearing: 0, duration: 500 });
    },
    zoomIn: () => {
      map.current?.zoomIn({ duration: 300 });
    },
    zoomOut: () => {
      map.current?.zoomOut({ duration: 300 });
    },
  }));

  // Animation loop for smooth interpolation
  const animatePosition = useCallback(() => {
    if (!userMarkerRef.current || !map.current) {
      animationRef.current = requestAnimationFrame(animatePosition);
      return;
    }

    const target = targetPositionRef.current;
    const current = currentPositionRef.current;

    if (target && current) {
      // Smoothly interpolate position
      const newLng = lerp(current.lng, target.lng, POSITION_LERP_SPEED);
      const newLat = lerp(current.lat, target.lat, POSITION_LERP_SPEED);
      
      // Only update if there's meaningful change
      const distChange = Math.abs(newLng - current.lng) + Math.abs(newLat - current.lat);
      if (distChange > 0.0000001) {
        currentPositionRef.current = { lng: newLng, lat: newLat };
        userMarkerRef.current.setLngLat([newLng, newLat]);
        
        // Smooth camera follow when auto-centering is enabled and user isn't dragging
        if (isAutoCentering.current && !userInteractingRef.current && map.current) {
          const mapCenter = map.current.getCenter();
          const targetCenterLng = lerp(mapCenter.lng, newLng, CAMERA_FOLLOW_SPEED);
          const targetCenterLat = lerp(mapCenter.lat, newLat, CAMERA_FOLLOW_SPEED);
          
          map.current.setCenter([targetCenterLng, targetCenterLat]);
        }
      }
    }

    // Smoothly interpolate heading
    const targetHeading = targetHeadingRef.current;
    const currentHeading = currentHeadingRef.current;
    const headingDiff = getAngleDiff(currentHeading, targetHeading);
    
    if (Math.abs(headingDiff) > 0.5) {
      const newHeading = normalizeAngle(currentHeading + headingDiff * HEADING_LERP_SPEED);
      currentHeadingRef.current = newHeading;
    }
    
    // Update avatar rotation based on mode
    if (userMarkerElRef.current) {
      const avatarEl = userMarkerElRef.current.querySelector('.user-avatar') as HTMLElement;
      if (avatarEl) {
        if (isFollowMode.current) {
          // In follow mode: avatar points UP, map rotates
          avatarEl.style.transform = `translate(-50%, -50%) rotate(0deg)`;
        } else {
          // In north-up mode: avatar rotates to show heading
          avatarEl.style.transform = `translate(-50%, -50%) rotate(${currentHeadingRef.current}deg)`;
        }
      }
    }
    
    // In follow mode, rotate the map bearing
    if (isFollowMode.current && map.current && !userInteractingRef.current) {
      const currentBearing = map.current.getBearing();
      const bearingDiff = getAngleDiff(currentBearing, targetHeadingRef.current);
      if (Math.abs(bearingDiff) > 0.5) {
        const newBearing = normalizeAngle(currentBearing + bearingDiff * HEADING_LERP_SPEED);
        map.current.setBearing(newBearing);
      }
    }

    animationRef.current = requestAnimationFrame(animatePosition);
  }, []);

  // Start animation loop
  useEffect(() => {
    animationRef.current = requestAnimationFrame(animatePosition);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [animatePosition]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    // Determine initial style
    let initialStyle: string;
    if (useSatellite) {
      initialStyle = "mapbox://styles/mapbox/satellite-streets-v12";
    } else {
      initialStyle = isDarkMode
        ? "mapbox://styles/mapbox/dark-v11"
        : "mapbox://styles/mapbox/light-v11";
    }

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: initialStyle,
      center,
      zoom,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false, // Start with north up
    });

    map.current.on("load", () => {
      setMapLoaded(true);

      if (map.current && onBoundsChange) {
        const bounds = map.current.getBounds();
        if (bounds) {
          onBoundsChange({
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
          });
        }
      }
    });

    // Detect when user starts interacting (pan/drag)
    map.current.on("dragstart", () => {
      userInteractingRef.current = true;
      // Disable auto-centering when user drags
      if (isAutoCentering.current) {
        isAutoCentering.current = false;
        onCenteredChange?.(false);
      }
    });

    map.current.on("dragend", () => {
      userInteractingRef.current = false;
    });

    map.current.on("moveend", () => {
      if (map.current && onBoundsChange) {
        const bounds = map.current.getBounds();
        if (bounds) {
          onBoundsChange({
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
          });
        }
      }
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Auto-center on user location (only once on initial load)
  useEffect(() => {
    if (!map.current || !mapLoaded || !userLocation || initialCenterSet.current) return;

    map.current.flyTo({
      center: [userLocation.longitude, userLocation.latitude],
      zoom: 15,
      duration: 1000,
    });
    initialCenterSet.current = true;
  }, [userLocation, mapLoaded]);

  // Update target position for animation when userLocation changes
  useEffect(() => {
    if (!userLocation) return;
    
    const newTarget = { lng: userLocation.longitude, lat: userLocation.latitude };
    targetPositionRef.current = newTarget;
    
    // Initialize current position if not set
    if (!currentPositionRef.current) {
      currentPositionRef.current = newTarget;
    }
    
    // Update target heading
    const heading = userLocation.effectiveHeading ?? userLocation.heading ?? null;
    if (heading !== null) {
      targetHeadingRef.current = heading;
    }
  }, [userLocation]);

  // Update map style when dark mode or satellite mode changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    let currentStyle: string;
    if (useSatellite) {
      currentStyle = "mapbox://styles/mapbox/satellite-streets-v12";
    } else {
      currentStyle = isDarkMode
        ? "mapbox://styles/mapbox/dark-v11"
        : "mapbox://styles/mapbox/light-v11";
    }

    map.current.setStyle(currentStyle);
  }, [isDarkMode, mapLoaded, useSatellite]);

  // Toggle traffic layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const mapInstance = map.current;

    const addTrafficLayer = () => {
      // Check if source already exists
      if (!mapInstance.getSource("mapbox-traffic")) {
        mapInstance.addSource("mapbox-traffic", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-traffic-v1",
        });
      }

      // Add traffic layer if it doesn't exist
      if (!mapInstance.getLayer("traffic-layer")) {
        mapInstance.addLayer({
          id: "traffic-layer",
          type: "line",
          source: "mapbox-traffic",
          "source-layer": "traffic",
          paint: {
            "line-width": 2,
            "line-color": [
              "match",
              ["get", "congestion"],
              "low", "#4ade80",
              "moderate", "#facc15", 
              "heavy", "#f97316",
              "severe", "#ef4444",
              "#6b7280"
            ],
            "line-opacity": 0.8,
          },
        });
      }
    };

    const removeTrafficLayer = () => {
      if (mapInstance.getLayer("traffic-layer")) {
        mapInstance.removeLayer("traffic-layer");
      }
      if (mapInstance.getSource("mapbox-traffic")) {
        mapInstance.removeSource("mapbox-traffic");
      }
    };

    if (showTraffic) {
      // Wait for style to be loaded before adding layer
      if (mapInstance.isStyleLoaded()) {
        addTrafficLayer();
      } else {
        mapInstance.once("styledata", addTrafficLayer);
      }
    } else {
      if (mapInstance.isStyleLoaded()) {
        removeTrafficLayer();
      }
    }

    return () => {
      mapInstance.off("styledata", addTrafficLayer);
    };
  }, [showTraffic, mapLoaded, isDarkMode]);

  // Create/update user location marker
  useEffect(() => {
    if (!map.current || !mapLoaded || !userLocation) return;

    const avatarSrc = isDarkMode ? "/maps-avatar.jpg" : "/maps-avatar-light.jpg";
    const initialHeading = userLocation.effectiveHeading ?? userLocation.heading ?? 0;

    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "user-marker";
      userMarkerElRef.current = el;
      
      // Create simple marker - just the avatar that rotates
      el.innerHTML = `
        <div class="user-avatar-container">
          <div class="user-avatar" style="transform: translate(-50%, -50%) rotate(${initialHeading}deg);">
            <img src="${avatarSrc}" alt="You" />
          </div>
          ${showAvatarPulse ? '<div class="user-avatar-pulse"></div>' : ''}
        </div>
      `;

      userMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([userLocation.longitude, userLocation.latitude])
        .addTo(map.current);
        
      // Initialize position refs
      currentPositionRef.current = { lng: userLocation.longitude, lat: userLocation.latitude };
      targetPositionRef.current = { lng: userLocation.longitude, lat: userLocation.latitude };
      currentHeadingRef.current = initialHeading;
      targetHeadingRef.current = initialHeading;
    }
  }, [userLocation, mapLoaded, isDarkMode]);

  // Update avatar image when dark mode changes
  useEffect(() => {
    if (!userMarkerRef.current) return;
    
    const avatarSrc = isDarkMode ? "/maps-avatar.jpg" : "/maps-avatar-light.jpg";
    const img = userMarkerRef.current.getElement().querySelector("img");
    if (img) {
      img.src = avatarSrc;
    }
  }, [isDarkMode]);

  // Update pulse visibility when setting changes
  useEffect(() => {
    if (!userMarkerElRef.current) return;
    
    const container = userMarkerElRef.current.querySelector('.user-avatar-container');
    if (!container) return;
    
    const existingPulse = container.querySelector('.user-avatar-pulse');
    
    if (showAvatarPulse && !existingPulse) {
      // Add pulse
      const pulse = document.createElement('div');
      pulse.className = 'user-avatar-pulse';
      container.appendChild(pulse);
    } else if (!showAvatarPulse && existingPulse) {
      // Remove pulse
      existingPulse.remove();
    }
  }, [showAvatarPulse]);

  // Update alert markers with clustering
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // Theme-aware colors
    const borderColor = isDarkMode ? "#3d3d3d" : "#f0f0f0";
    const shadowColor = isDarkMode ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)";
    const popupBg = isDarkMode ? "#1a1a1a" : "white";
    const popupText = isDarkMode ? "#e5e5e5" : "#374151";
    const popupSubtext = isDarkMode ? "#9ca3af" : "#6b7280";

    // Cluster nearby alerts
    const clusters = clusterAlerts(alerts);

    clusters.forEach((cluster) => {
      const el = document.createElement("div");
      el.className = "alert-marker";

      const isCluster = cluster.alerts.length > 1;
      const color = ALERT_COLORS[cluster.mostSevereType] || "#6b7280";
      const icon = ALERT_ICONS[cluster.mostSevereType] || "📍";

      if (isCluster) {
        // Cluster marker - shows count with most severe color
        const count = cluster.alerts.length;
        const size = Math.min(56, 40 + count * 2); // Grow slightly with more alerts
        
        el.innerHTML = `
          <div class="alert-pin cluster" style="
            position: relative;
            cursor: pointer;
            transition: transform 0.15s ease-out;
            filter: drop-shadow(0 4px 8px ${shadowColor});
          ">
            <div class="alert-pin-body" style="
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              width: ${size}px;
              height: ${size}px;
              background: ${color};
              border: 3px solid ${borderColor};
              border-radius: 12px;
              font-size: 14px;
              gap: 1px;
            ">
              <span style="font-size: 14px;">${icon}</span>
              <span style="font-size: 11px; font-weight: 600; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">+${count}</span>
            </div>
            <div class="alert-pin-point" style="
              position: absolute;
              bottom: -10px;
              left: 50%;
              transform: translateX(-50%);
              width: 0;
              height: 0;
              border-left: 10px solid transparent;
              border-right: 10px solid transparent;
              border-top: 12px solid ${borderColor};
            "></div>
            <div class="alert-pin-point-inner" style="
              position: absolute;
              bottom: -6px;
              left: 50%;
              transform: translateX(-50%);
              width: 0;
              height: 0;
              border-left: 7px solid transparent;
              border-right: 7px solid transparent;
              border-top: 9px solid ${color};
            "></div>
          </div>
        `;

        // Cluster popup shows breakdown
        const typeCounts: Record<string, number> = {};
        cluster.alerts.forEach((a) => {
          typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
        });

        const breakdownHtml = Object.entries(typeCounts)
          .sort(([a], [b]) => (ALERT_SEVERITY[b] ?? 0) - (ALERT_SEVERITY[a] ?? 0))
          .map(([type, cnt]) => `
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <span>${ALERT_ICONS[type] || "📍"}</span>
              <span style="color: ${ALERT_COLORS[type]}; font-weight: 500;">${type.replace(/_/g, " ")}</span>
              <span style="color: ${popupSubtext};">×${cnt}</span>
            </div>
          `).join("");

        const popupContent = `
          <div class="alert-popup" style="background: ${popupBg}; color: ${popupText};">
            <div class="alert-popup-header" style="color: ${color}; margin-bottom: 8px;">
              ⚠️ ${count} Reports in Area
            </div>
            ${breakdownHtml}
          </div>
        `;

        const popup = new mapboxgl.Popup({
          offset: 35,
          closeButton: false,
          maxWidth: "240px",
          className: `alert-popup-container ${isDarkMode ? "dark" : ""}`,
        }).setHTML(popupContent);

        const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([cluster.center.x, cluster.center.y])
          .setPopup(popup)
          .addTo(map.current!);

        markersRef.current.push(marker);
      } else {
        // Single alert marker
        const alert = cluster.alerts[0];
        
        el.innerHTML = `
          <div class="alert-pin" style="
            position: relative;
            cursor: pointer;
            transition: transform 0.15s ease-out;
            filter: drop-shadow(0 3px 6px ${shadowColor});
          ">
            <div class="alert-pin-body" style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 40px;
              height: 40px;
              background: ${color};
              border: 3px solid ${borderColor};
              border-radius: 10px;
              font-size: 18px;
            ">
              ${icon}
            </div>
            <div class="alert-pin-point" style="
              position: absolute;
              bottom: -8px;
              left: 50%;
              transform: translateX(-50%);
              width: 0;
              height: 0;
              border-left: 8px solid transparent;
              border-right: 8px solid transparent;
              border-top: 10px solid ${borderColor};
            "></div>
            <div class="alert-pin-point-inner" style="
              position: absolute;
              bottom: -4px;
              left: 50%;
              transform: translateX(-50%);
              width: 0;
              height: 0;
              border-left: 5px solid transparent;
              border-right: 5px solid transparent;
              border-top: 7px solid ${color};
            "></div>
          </div>
        `;

        const popupContent = `
          <div class="alert-popup" style="background: ${popupBg}; color: ${popupText};">
            <div class="alert-popup-header" style="color: ${color}">
              ${icon} ${alert.type.replace(/_/g, " ")}
            </div>
            ${alert.street ? `<div class="alert-popup-street" style="color: ${popupText}">${alert.street}</div>` : ""}
            ${alert.subtype ? `<div class="alert-popup-subtype" style="color: ${popupSubtext}">${alert.subtype.replace(/_/g, " ")}</div>` : ""}
            ${alert.reportDescription ? `<div class="alert-popup-desc" style="color: ${popupSubtext}">${alert.reportDescription}</div>` : ""}
            <div class="alert-popup-meta" style="color: ${popupSubtext}">
              ${alert.nThumbsUp ? `<span>👍 ${alert.nThumbsUp}</span>` : ""}
              ${alert.reliability ? `<span>⭐ ${alert.reliability}/10</span>` : ""}
            </div>
          </div>
        `;

        const popup = new mapboxgl.Popup({
          offset: 30,
          closeButton: false,
          maxWidth: "240px",
          className: `alert-popup-container ${isDarkMode ? "dark" : ""}`,
        }).setHTML(popupContent);

        const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([alert.location.x, alert.location.y])
          .setPopup(popup)
          .addTo(map.current!);

        markersRef.current.push(marker);
      }

      // Hover effect for all markers
      el.addEventListener("mouseenter", () => {
        const pinEl = el.querySelector(".alert-pin") as HTMLElement;
        if (pinEl) pinEl.style.transform = "scale(1.15) translateY(-3px)";
      });

      el.addEventListener("mouseleave", () => {
        const pinEl = el.querySelector(".alert-pin") as HTMLElement;
        if (pinEl) pinEl.style.transform = "scale(1)";
      });

      // Track marker clicks
      el.addEventListener("click", () => {
        const isCluster = cluster.alerts.length > 1;
        posthog.capture("alert_marker_clicked", {
          is_cluster: isCluster,
          alert_count: cluster.alerts.length,
          alert_type: cluster.mostSevereType,
          alert_types: isCluster
            ? Array.from(new Set(cluster.alerts.map((a) => a.type)))
            : [cluster.mostSevereType],
        });
      });
    });
  }, [alerts, mapLoaded, isDarkMode]);

  return (
    <>
      <div
        ref={mapContainer}
        className="w-full h-full"
        style={{ position: "absolute", inset: 0 }}
      />
      <style jsx global>{`
        .user-avatar-container {
          position: relative;
          width: 56px;
          height: 56px;
        }
        
        .user-avatar {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 36px;
          height: 36px;
          z-index: 3;
          transition: transform 0.1s ease-out;
        }
        
        .user-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
      
        }
        
        .user-avatar-pulse {
          position: absolute;
          width: 56px;
          height: 56px;
          background: rgba(59, 130, 246, 0.25);
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          animation: avatar-pulse 2s infinite;
          z-index: 1;
        }
        
        @keyframes avatar-pulse {
          0% {
            transform: translate(-50%, -50%) scale(0.7);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.3);
            opacity: 0;
          }
        }
        
        .alert-popup-container .mapboxgl-popup-content {
          padding: 0;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.2);
          overflow: hidden;
          background: transparent;
        }
        
        .alert-popup-container.dark .mapboxgl-popup-content {
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        
        .alert-popup {
          padding: 12px 14px;
          border-radius: 12px;
        }
        
        .alert-popup-header {
          font-weight: 600;
          font-size: 13px;
          margin-bottom: 4px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        
        .alert-popup-street {
          font-size: 12px;
          margin-bottom: 2px;
        }
        
        .alert-popup-subtype {
          font-size: 11px;
          text-transform: lowercase;
        }
        
        .alert-popup-desc {
          font-size: 11px;
          margin-top: 6px;
          line-height: 1.4;
        }
        
        .alert-popup-meta {
          font-size: 10px;
          margin-top: 8px;
          display: flex;
          gap: 10px;
        }
        
        .mapboxgl-popup-tip {
          border-top-color: white;
        }
        
        .alert-popup-container.dark .mapboxgl-popup-tip {
          border-top-color: #1a1a1a;
        }
      `}</style>
    </>
  );
});
