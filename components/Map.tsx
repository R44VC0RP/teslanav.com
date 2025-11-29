"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { WazeAlert, MapBounds } from "@/types/waze";
import type { SpeedCamera } from "@/types/speedcamera";
import posthog from "posthog-js";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

interface MapProps {
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  isDarkMode?: boolean;
  alerts?: WazeAlert[];
  speedCameras?: SpeedCamera[];
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
  POLICE: "/icons/police.svg",
  ACCIDENT: "/icons/accident.svg",
  HAZARD: "/icons/hazard.svg",
  ROAD_CLOSED: "/icons/closure.svg",
  JAM: "/icons/object-on-road.svg",
};

// Speed camera icons
const CAMERA_ICONS: Record<string, string> = {
  speed_camera: "/icons/speed-camera.svg",
  red_light_camera: "/icons/red-light-camera.svg",
  average_speed_camera: "/icons/speed-camera.svg", // Use same icon as speed camera
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

// Hide POI and place labels from the map
function hidePlaceLabels(mapInstance: mapboxgl.Map) {
  const style = mapInstance.getStyle();
  if (!style || !style.layers) return;

  // Layer patterns to hide (POIs, places, landmarks)
  const labelsToHide = [
    'poi-label',
    'transit-label', 
    'place-label',
    'settlement-label',
    'settlement-subdivision-label',
    'airport-label',
    'natural-point-label',
    'water-point-label',
    'waterway-label',
  ];

  style.layers.forEach((layer) => {
    // Check if layer ID contains any of the label patterns
    const shouldHide = labelsToHide.some(pattern => 
      layer.id.includes(pattern)
    );
    
    if (shouldHide && mapInstance.getLayer(layer.id)) {
      mapInstance.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  });
}

export const Map = forwardRef<MapRef, MapProps>(function Map(
  {
    center = [-122.4194, 37.7749],
    zoom = 13,
    isDarkMode = false,
    alerts = [],
    speedCameras = [],
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
  const cameraMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const userMarkerElRef = useRef<HTMLDivElement | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const initialCenterSet = useRef(false);
  const isFollowMode = useRef(followMode);
  
  // Track if we should auto-center (user hasn't panned away)
  const isAutoCentering = useRef(true);
  const userInteractingRef = useRef(false);
  const isZoomingRef = useRef(false);
  
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
        zoom: 15, // Reset to default zoom level
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
      // Set zooming flag immediately to prevent auto-centering from interfering
      isZoomingRef.current = true;
      map.current?.zoomIn({ duration: 300 });
    },
    zoomOut: () => {
      // Set zooming flag immediately to prevent auto-centering from interfering
      isZoomingRef.current = true;
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
        
        // Smooth camera follow when auto-centering is enabled and user isn't interacting
        // Skip if user is dragging or zooming to avoid fighting with map interactions
        if (isAutoCentering.current && !userInteractingRef.current && !isZoomingRef.current && map.current) {
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
      // Use standard satellite with streets overlay for better detail
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

      // Hide POI and place labels
      if (map.current) {
        hidePlaceLabels(map.current);
      }

      if (map.current && onBoundsChange) {
        const bounds = map.current.getBounds();
        if (bounds) {
          onBoundsChange({
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
            zoom: map.current.getZoom(),
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

    // Track zoom interactions to prevent auto-centering from fighting with zoom animations
    map.current.on("zoomstart", () => {
      isZoomingRef.current = true;
    });

    map.current.on("zoomend", () => {
      isZoomingRef.current = false;
    });

    // Track touch interactions for better mobile experience
    // On touchmove, disable auto-centering since user is panning
    map.current.on("touchstart", () => {
      userInteractingRef.current = true;
    });

    map.current.on("touchmove", () => {
      // Disable auto-centering when user pans via touch
      if (isAutoCentering.current) {
        isAutoCentering.current = false;
        onCenteredChange?.(false);
      }
    });

    map.current.on("touchend", () => {
      // Small delay to allow any animations to start before resuming auto-center
      setTimeout(() => {
        userInteractingRef.current = false;
      }, 100);
    });

    // Also track mouse interactions for desktop
    map.current.on("mousedown", () => {
      userInteractingRef.current = true;
    });

    map.current.on("mouseup", () => {
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
            zoom: map.current.getZoom(),
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
      // Use standard satellite with streets overlay for better detail
      currentStyle = "mapbox://styles/mapbox/satellite-streets-v12";
    } else {
      currentStyle = isDarkMode
        ? "mapbox://styles/mapbox/dark-v11"
        : "mapbox://styles/mapbox/light-v11";
    }

    map.current.setStyle(currentStyle);
    
    // Hide labels after style loads
    map.current.once("style.load", () => {
      if (map.current) {
        hidePlaceLabels(map.current);
      }
    });
  }, [isDarkMode, mapLoaded, useSatellite]);

  // Toggle traffic layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const mapInstance = map.current;

    const addTrafficLayer = () => {
      // Safety check - make sure style is loaded and map still exists
      if (!mapInstance.isStyleLoaded()) return;
      
      // Check if source already exists
      if (!mapInstance.getSource("mapbox-traffic")) {
        mapInstance.addSource("mapbox-traffic", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-traffic-v1",
        });
      }

      // Add traffic layer if it doesn't exist
      // Only show congested sections (moderate, heavy, severe) - no green/low traffic
      if (!mapInstance.getLayer("traffic-layer")) {
        mapInstance.addLayer({
          id: "traffic-layer",
          type: "line",
          source: "mapbox-traffic",
          "source-layer": "traffic",
          filter: [
            "in",
            ["get", "congestion"],
            ["literal", ["moderate", "heavy", "severe"]]
          ],
          paint: {
            "line-width": 3,
            "line-color": [
              "match",
              ["get", "congestion"],
              "moderate", "#facc15", 
              "heavy", "#f97316",
              "severe", "#ef4444",
              "#f97316"
            ],
            "line-opacity": 0.85,
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

    // Handler for when style loads/changes - re-add traffic if enabled
    const handleStyleLoad = () => {
      if (showTraffic) {
        addTrafficLayer();
      }
    };

    if (showTraffic) {
      // Wait for style to be loaded before adding layer
      if (mapInstance.isStyleLoaded()) {
        addTrafficLayer();
      }
      // Also listen for future style changes to re-add the layer
      mapInstance.on("style.load", handleStyleLoad);
    } else {
      if (mapInstance.isStyleLoaded()) {
        removeTrafficLayer();
      }
    }

    return () => {
      mapInstance.off("style.load", handleStyleLoad);
    };
  }, [showTraffic, mapLoaded, isDarkMode, useSatellite]);

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
    const shadowColor = isDarkMode ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.15)";
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
      const icon = ALERT_ICONS[cluster.mostSevereType] || "/icons/hazard.svg";

      if (isCluster) {
        // Cluster marker - minimal bubble with count badge
        const count = cluster.alerts.length;
        
        el.innerHTML = `
          <div class="alert-pin cluster" style="
            position: relative;
            cursor: pointer;
            transition: transform 0.15s ease-out;
          ">
            <div class="alert-pin-body" style="
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              <img src="${icon}" alt="${cluster.mostSevereType}" style="width: 44px; height: auto;" />
            </div>
            <div class="alert-badge" style="
              position: absolute;
              top: -2px;
              right: -2px;
              min-width: 18px;
              height: 18px;
              background: white;
              border-radius: 9px;
              font-size: 11px;
              font-weight: 700;
              color: ${color};
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 0 4px;
              box-shadow: 0 1px 3px ${shadowColor};
            ">+${count}</div>
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
              <span style="color: ${ALERT_COLORS[type]}; font-weight: 500;">${type.replace(/_/g, " ")}</span>
              <span style="color: ${popupSubtext};">×${cnt}</span>
            </div>
          `).join("");

        const popupContent = `
          <div class="alert-popup" style="background: ${popupBg}; color: ${popupText};">
            <div class="alert-popup-header" style="color: ${color}; margin-bottom: 8px;">
              ${count} Reports in Area
            </div>
            ${breakdownHtml}
          </div>
        `;

        const popup = new mapboxgl.Popup({
          offset: 25,
          closeButton: false,
          maxWidth: "240px",
          className: `alert-popup-container ${isDarkMode ? "dark" : ""}`,
        }).setHTML(popupContent);

        const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([cluster.center.x, cluster.center.y])
          .setPopup(popup)
          .addTo(map.current!);

        markersRef.current.push(marker);
      } else {
        // Single alert marker - minimal bubble
        const alert = cluster.alerts[0];
        
        el.innerHTML = `
          <div class="alert-pin" style="
            position: relative;
            cursor: pointer;
            transition: transform 0.15s ease-out;
          ">
            <div class="alert-pin-body" style="
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              <img src="${icon}" alt="${alert.type}" style="width: 36px; height: auto;" />
            </div>
          </div>
        `;

        const popupContent = `
          <div class="alert-popup" style="background: ${popupBg}; color: ${popupText};">
            <div class="alert-popup-header" style="color: ${color}">
              ${alert.type.replace(/_/g, " ")}
            </div>
            ${alert.street ? `<div class="alert-popup-street" style="color: ${popupText}">${alert.street}</div>` : ""}
            ${alert.subtype ? `<div class="alert-popup-subtype" style="color: ${popupSubtext}">${alert.subtype.replace(/_/g, " ")}</div>` : ""}
            ${alert.reportDescription ? `<div class="alert-popup-desc" style="color: ${popupSubtext}">${alert.reportDescription}</div>` : ""}
            <div class="alert-popup-meta" style="color: ${popupSubtext}">
              ${alert.nThumbsUp ? `<span style="display: inline-flex; align-items: center; gap: 3px;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width: 12px; height: 12px;">
                  <path d="M7.493 18.5c-.425 0-.82-.236-.975-.632A7.48 7.48 0 0 1 6 15.125c0-1.75.599-3.358 1.602-4.634.151-.192.373-.309.6-.397.473-.183.89-.514 1.212-.924a9.042 9.042 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V3a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H14.23c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23h-.777ZM2.331 10.727a11.969 11.969 0 0 0-.831 4.398 12 12 0 0 0 .52 3.507C2.28 19.482 3.105 20 3.994 20H4.9c.445 0 .72-.498.523-.898a8.963 8.963 0 0 1-.924-3.977c0-1.708.476-3.305 1.302-4.666.245-.403-.028-.959-.5-.959H4.25c-.832 0-1.612.453-1.918 1.227Z" />
                </svg>
                ${alert.nThumbsUp}
              </span>` : ""}
              ${alert.reliability ? `<span style="display: inline-flex; align-items: center; gap: 3px;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width: 12px; height: 12px;">
                  <path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clip-rule="evenodd" />
                </svg>
                ${alert.reliability}/10
              </span>` : ""}
            </div>
          </div>
        `;

        const popup = new mapboxgl.Popup({
          offset: 20,
          closeButton: false,
          maxWidth: "240px",
          className: `alert-popup-container ${isDarkMode ? "dark" : ""}`,
        }).setHTML(popupContent);

        const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
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

  // Update speed camera markers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Clear existing camera markers
    cameraMarkersRef.current.forEach((marker) => marker.remove());
    cameraMarkersRef.current = [];

    // Theme-aware colors
    const popupBg = isDarkMode ? "#1a1a1a" : "white";
    const popupText = isDarkMode ? "#e5e5e5" : "#374151";
    const popupSubtext = isDarkMode ? "#9ca3af" : "#6b7280";

    speedCameras.forEach((camera) => {
      const el = document.createElement("div");
      el.className = "camera-marker";

      const icon = CAMERA_ICONS[camera.type] || CAMERA_ICONS.speed_camera;
      const cameraTypeLabel = camera.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

      el.innerHTML = `
        <div class="camera-pin" style="
          position: relative;
          cursor: pointer;
          transition: transform 0.15s ease-out;
        ">
          <div class="camera-pin-body" style="
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <img src="${icon}" alt="${cameraTypeLabel}" style="width: 36px; height: auto;" />
          </div>
        </div>
      `;

      // Build popup content
      let popupDetails = "";
      if (camera.maxspeed) {
        popupDetails += `<div class="camera-popup-speed" style="color: ${popupText}; font-weight: 600; font-size: 14px;">Limit: ${camera.maxspeed} mph</div>`;
      }
      if (camera.direction) {
        popupDetails += `<div class="camera-popup-direction" style="color: ${popupSubtext}; font-size: 11px; text-transform: capitalize;">Direction: ${camera.direction}</div>`;
      }

      const popupContent = `
        <div class="alert-popup" style="background: ${popupBg}; color: ${popupText};">
          <div class="alert-popup-header" style="color: #ef4444; margin-bottom: 4px;">
            📷 ${cameraTypeLabel}
          </div>
          ${popupDetails}
          <div class="camera-popup-source" style="color: ${popupSubtext}; font-size: 10px; margin-top: 6px;">
            Source: OpenStreetMap
          </div>
        </div>
      `;

      const popup = new mapboxgl.Popup({
        offset: 20,
        closeButton: false,
        maxWidth: "200px",
        className: `alert-popup-container ${isDarkMode ? "dark" : ""}`,
      }).setHTML(popupContent);

      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([camera.location.lon, camera.location.lat])
        .setPopup(popup)
        .addTo(map.current!);

      cameraMarkersRef.current.push(marker);

      // Hover effect
      el.addEventListener("mouseenter", () => {
        const pinEl = el.querySelector(".camera-pin") as HTMLElement;
        if (pinEl) pinEl.style.transform = "scale(1.15) translateY(-3px)";
      });

      el.addEventListener("mouseleave", () => {
        const pinEl = el.querySelector(".camera-pin") as HTMLElement;
        if (pinEl) pinEl.style.transform = "scale(1)";
      });

      // Track clicks
      el.addEventListener("click", () => {
        posthog.capture("speed_camera_clicked", {
          camera_type: camera.type,
          has_maxspeed: !!camera.maxspeed,
          maxspeed: camera.maxspeed,
        });
      });
    });
  }, [speedCameras, mapLoaded, isDarkMode]);

  return (
    <>
      <div
        ref={mapContainer}
        className="w-full h-full"
        style={{ position: "absolute", inset: 0 }}
      />
      <style jsx global>{`
        .user-marker {
          z-index: 10 !important;
        }
        
        .user-avatar-container {
          position: relative;
          width: 72px;
          height: 72px;
        }
        
        .user-avatar {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 48px;
          height: 48px;
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
          width: 72px;
          height: 72px;
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