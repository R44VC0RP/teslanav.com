"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { WazeAlert, MapBounds } from "@/types/waze";
import type { SpeedCamera } from "@/types/speedcamera";
import type { RouteData } from "@/types/route";
import type { UserPosition } from "@/lib/realtime";
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
  onLongPress?: (lng: number, lat: number, screenX: number, screenY: number) => void;
  pinLocation?: { lng: number; lat: number } | null;
  route?: RouteData | null; // Legacy single route support
  routes?: RouteData[]; // Multiple routes for selection
  selectedRouteIndex?: number; // Which route is selected (0 = first/fastest)
  userLocation?: { 
    latitude: number; 
    longitude: number; 
    heading?: number | null;
    effectiveHeading?: number | null;
    speed?: number | null; // m/s
  } | null;
  followMode?: boolean;
  showTraffic?: boolean;
  useSatellite?: boolean;
  showAvatarPulse?: boolean;
  // Dev mode - show alert radius ring
  showAlertRadius?: boolean;
  alertRadiusMeters?: number;
  // Dev mode - show cached Waze tile bounds
  debugTileBounds?: Array<{ bounds: MapBounds; ageMs: number }>;
  // Real-time other users
  otherUsers?: UserPosition[];
}

export interface MapRef {
  recenter: (lng: number, lat: number) => void;
  enableAutoCentering: () => void;
  setFollowMode: (enabled: boolean) => void;
  resetNorth: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  flyToDestination: (lng: number, lat: number) => void;
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

// Calculate night overlay opacity based on time of day (0 = no overlay, 1 = full dark)
// Uses a smooth curve: darkest at midnight, brightest at noon
function getNightOverlayOpacity(): number {
  const hour = new Date().getHours();
  const minute = new Date().getMinutes();
  const timeDecimal = hour + minute / 60;
  
  // Map time to darkness level:
  // 0-5am: dark (0.4-0.3)
  // 5-7am: sunrise transition (0.3-0)
  // 7am-5pm: day (0)
  // 5-7pm: sunset transition (0-0.2)
  // 7-10pm: evening (0.2-0.35)
  // 10pm-midnight: night (0.35-0.4)
  
  if (timeDecimal >= 7 && timeDecimal < 17) {
    // Daytime: no overlay
    return 0;
  } else if (timeDecimal >= 5 && timeDecimal < 7) {
    // Sunrise: fade from dark to light
    const progress = (timeDecimal - 5) / 2;
    return 0.3 * (1 - progress);
  } else if (timeDecimal >= 17 && timeDecimal < 19) {
    // Sunset: fade from light to dark
    const progress = (timeDecimal - 17) / 2;
    return 0.2 * progress;
  } else if (timeDecimal >= 19 && timeDecimal < 22) {
    // Evening: gradually darker
    const progress = (timeDecimal - 19) / 3;
    return 0.2 + 0.15 * progress;
  } else if (timeDecimal >= 22 || timeDecimal < 2) {
    // Late night: darkest
    return 0.4;
  } else {
    // Early morning (2-5am): slightly lighter than midnight
    const progress = (timeDecimal - 2) / 3;
    return 0.4 - 0.1 * progress;
  }
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
    onLongPress,
    pinLocation,
    route,
    routes = [],
    selectedRouteIndex = 0,
    userLocation,
    followMode = false,
    showTraffic = false,
    useSatellite = false,
    showAvatarPulse = true,
    showAlertRadius = false,
    alertRadiusMeters = 500,
    debugTileBounds,
    otherUsers = [],
  },
  ref
) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  // Use Maps for incremental marker updates (key = unique ID)
  const markersRef = useRef<globalThis.Map<string, mapboxgl.Marker>>(new globalThis.Map());
  const cameraMarkersRef = useRef<globalThis.Map<string, mapboxgl.Marker>>(new globalThis.Map());
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const userMarkerElRef = useRef<HTMLDivElement | null>(null);
  const pinMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const otherUserMarkersRef = useRef<globalThis.Map<string, mapboxgl.Marker>>(new globalThis.Map());
  const [mapLoaded, setMapLoaded] = useState(false);
  const [nightOverlayOpacity, setNightOverlayOpacity] = useState(0);
  const initialCenterSet = useRef(false);
  const isFollowMode = useRef(followMode);
  
  // Track if we should auto-center (user hasn't panned away)
  const isAutoCentering = useRef(true);
  const userInteractingRef = useRef(false);
  const isZoomingRef = useRef(false);
  
  // Track showTraffic prop for use in callbacks (closure-safe)
  const showTrafficPropRef = useRef(showTraffic);
  
  // Long press handling
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const LONG_PRESS_DURATION = 500; // ms
  const LONG_PRESS_MOVE_THRESHOLD = 10; // pixels
  
  // Animation state for smooth interpolation
  const animationRef = useRef<number | null>(null);
  const currentPositionRef = useRef<{ lng: number; lat: number } | null>(null);
  const targetPositionRef = useRef<{ lng: number; lat: number } | null>(null);
  const currentHeadingRef = useRef<number>(0);
  const targetHeadingRef = useRef<number>(0);
  
  // Animation speed config
  const POSITION_LERP_SPEED = 0.15; // How fast to interpolate position (0-1, higher = faster)
  const HEADING_LERP_SPEED = 0.15; // How fast to interpolate heading
  const CAMERA_FOLLOW_SPEED = 0.12; // How fast camera follows (increased for snappier tracking)
  
  // Speed-based zoom config
  const lastSpeedRef = useRef<number | null>(null);
  const speedZoomTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const SPEED_ZOOM_DEBOUNCE = 2000; // ms - wait before adjusting zoom after speed change
  const SPEED_THRESHOLD_LOW = 8; // m/s (~29 km/h, ~18 mph) - residential driving
  const SPEED_THRESHOLD_HIGH = 22; // m/s (~79 km/h, ~49 mph) - highway driving
  const ZOOM_ADJUSTMENT_AMOUNT = 0.8; // How much to adjust zoom by

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
    enableAutoCentering: () => {
      // Just enable auto-centering without any animation
      // The normal position updates will handle centering
      isAutoCentering.current = true;
      onCenteredChange?.(true);
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
    flyToDestination: (lng: number, lat: number) => {
      // Disable auto-centering when navigating to a destination
      isAutoCentering.current = false;
      onCenteredChange?.(false);
      
      map.current?.flyTo({
        center: [lng, lat],
        zoom: 16,
        duration: 1500,
        essential: true,
      });
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

  // Speed-based dynamic zoom adjustment
  // When driving faster, zoom out for more context; when slower, zoom in for detail
  useEffect(() => {
    if (!map.current || !mapLoaded || !isAutoCentering.current) return;
    
    const currentSpeed = userLocation?.speed;
    if (currentSpeed === null || currentSpeed === undefined) return;
    
    const lastSpeed = lastSpeedRef.current;
    
    // Initialize last speed on first reading
    if (lastSpeed === null) {
      lastSpeedRef.current = currentSpeed;
      return;
    }
    
    // Determine if we crossed a speed threshold
    const wasSlowDriving = lastSpeed < SPEED_THRESHOLD_LOW;
    const isSlowDriving = currentSpeed < SPEED_THRESHOLD_LOW;
    const wasFastDriving = lastSpeed >= SPEED_THRESHOLD_HIGH;
    const isFastDriving = currentSpeed >= SPEED_THRESHOLD_HIGH;
    
    // Check for threshold crossings
    let shouldZoomOut = false;
    let shouldZoomIn = false;
    
    // Transition from slow to medium/fast -> zoom out
    if (wasSlowDriving && !isSlowDriving) {
      shouldZoomOut = true;
    }
    // Transition from medium to fast -> zoom out more
    else if (!wasFastDriving && isFastDriving) {
      shouldZoomOut = true;
    }
    // Transition from fast to medium/slow -> zoom in
    else if (wasFastDriving && !isFastDriving) {
      shouldZoomIn = true;
    }
    // Transition from medium to slow -> zoom in more
    else if (!wasSlowDriving && isSlowDriving) {
      shouldZoomIn = true;
    }
    
    // Update last speed
    lastSpeedRef.current = currentSpeed;
    
    // Only adjust if threshold was crossed
    if (!shouldZoomOut && !shouldZoomIn) return;
    
    // Clear any pending zoom adjustment
    if (speedZoomTimeoutRef.current) {
      clearTimeout(speedZoomTimeoutRef.current);
    }
    
    // Debounce the zoom adjustment to prevent rapid changes
    speedZoomTimeoutRef.current = setTimeout(() => {
      if (!map.current || !isAutoCentering.current || userInteractingRef.current || isZoomingRef.current) return;
      
      const currentZoom = map.current.getZoom();
      const targetZoom = shouldZoomOut 
        ? Math.max(currentZoom - ZOOM_ADJUSTMENT_AMOUNT, 11) // Min zoom ~11 for highway context
        : Math.min(currentZoom + ZOOM_ADJUSTMENT_AMOUNT, 17); // Max zoom ~17 for residential detail
      
      map.current.easeTo({
        zoom: targetZoom,
        duration: 1000,
      });
    }, SPEED_ZOOM_DEBOUNCE);
    
    return () => {
      if (speedZoomTimeoutRef.current) {
        clearTimeout(speedZoomTimeoutRef.current);
      }
    };
  }, [userLocation?.speed, mapLoaded]);

  // Update night overlay opacity based on time of day (satellite mode only)
  useEffect(() => {
    if (!useSatellite) {
      setNightOverlayOpacity(0);
      return;
    }

    // Set initial value
    setNightOverlayOpacity(getNightOverlayOpacity());

    // Update every minute
    const interval = setInterval(() => {
      setNightOverlayOpacity(getNightOverlayOpacity());
    }, 60000);

    return () => clearInterval(interval);
  }, [useSatellite]);

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

      // Add traffic layer immediately on load if enabled
      // This is the most reliable place because we KNOW the style is fully loaded
      // Use ref to get current value (not the stale closure value)
      const addInitialTraffic = () => {
        if (!map.current || !showTrafficPropRef.current) return;
        try {
          if (!map.current.getSource("mapbox-traffic")) {
            map.current.addSource("mapbox-traffic", {
              type: "vector",
              url: "mapbox://mapbox.mapbox-traffic-v1",
            });
          }
          if (!map.current.getLayer("traffic-layer")) {
            map.current.addLayer({
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
        } catch (e) {
          console.log("Error adding initial traffic layer:", e);
        }
      };
      
      // Try immediately
      addInitialTraffic();
      
      // Also try after a short delay as fallback (handles edge cases with ref timing)
      setTimeout(addInitialTraffic, 200);
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

  // Long press handler for "navigate to" functionality
  useEffect(() => {
    if (!map.current || !mapLoaded || !onLongPress) return;

    const mapInstance = map.current;
    const canvas = mapInstance.getCanvasContainer();

    const clearLongPress = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressStartRef.current = null;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        clearLongPress();
        return;
      }

      const touch = e.touches[0];
      longPressStartRef.current = { x: touch.clientX, y: touch.clientY };

      longPressTimerRef.current = setTimeout(() => {
        if (longPressStartRef.current && map.current) {
          // Get the coordinates from the touch point
          const point = map.current.unproject([
            touch.clientX - canvas.getBoundingClientRect().left,
            touch.clientY - canvas.getBoundingClientRect().top,
          ]);
          
          // Trigger haptic feedback if available
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
          
          onLongPress(point.lng, point.lat, touch.clientX, touch.clientY);
        }
        clearLongPress();
      }, LONG_PRESS_DURATION);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!longPressStartRef.current || e.touches.length !== 1) {
        clearLongPress();
        return;
      }

      const touch = e.touches[0];
      const dx = touch.clientX - longPressStartRef.current.x;
      const dy = touch.clientY - longPressStartRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > LONG_PRESS_MOVE_THRESHOLD) {
        clearLongPress();
      }
    };

    const handleTouchEnd = () => {
      clearLongPress();
    };

    // Also support right-click on desktop
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (map.current) {
        const point = map.current.unproject([
          e.clientX - canvas.getBoundingClientRect().left,
          e.clientY - canvas.getBoundingClientRect().top,
        ]);
        onLongPress(point.lng, point.lat, e.clientX, e.clientY);
      }
    };

    canvas.addEventListener("touchstart", handleTouchStart, { passive: true });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: true });
    canvas.addEventListener("touchend", handleTouchEnd);
    canvas.addEventListener("touchcancel", handleTouchEnd);
    canvas.addEventListener("contextmenu", handleContextMenu);

    return () => {
      clearLongPress();
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchEnd);
      canvas.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [mapLoaded, onLongPress]);

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

  // Track initial style to avoid unnecessary setStyle calls
  const initialStyleRef = useRef<string | null>(null);

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

    // Skip setStyle if this is the initial load and style hasn't changed
    // This prevents an unnecessary style reload that causes timing issues
    if (initialStyleRef.current === null) {
      initialStyleRef.current = currentStyle;
      // Initial style was set in the constructor, just hide labels
      if (map.current.isStyleLoaded()) {
        hidePlaceLabels(map.current);
      } else {
        map.current.once("style.load", () => {
          if (map.current) {
            hidePlaceLabels(map.current);
          }
        });
      }
      return;
    }

    // Only call setStyle if the style actually changed
    if (currentStyle !== initialStyleRef.current) {
      initialStyleRef.current = currentStyle;
      map.current.setStyle(currentStyle);
      
      // Hide labels after style loads
      map.current.once("style.load", () => {
        if (map.current) {
          hidePlaceLabels(map.current);
        }
      });
    }
  }, [isDarkMode, mapLoaded, useSatellite]);

  // Track showTraffic in a ref so style.load handler always has current value
  const showTrafficRef = useRef(showTraffic);
  useEffect(() => {
    showTrafficRef.current = showTraffic;
    showTrafficPropRef.current = showTraffic;
  }, [showTraffic]);

  // Set up persistent style.load listener for traffic layer (runs once when map loads)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const mapInstance = map.current;

    const addTrafficLayer = () => {
      if (!mapInstance.isStyleLoaded()) return;
      
      try {
        if (!mapInstance.getSource("mapbox-traffic")) {
          mapInstance.addSource("mapbox-traffic", {
            type: "vector",
            url: "mapbox://mapbox.mapbox-traffic-v1",
          });
        }

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
      } catch (e) {
        console.log("Error adding traffic layer:", e);
      }
    };

    // Handler for when style loads/changes - re-add traffic if enabled
    const handleStyleLoad = () => {
      if (showTrafficRef.current) {
        // Small delay to ensure style is fully ready
        setTimeout(() => addTrafficLayer(), 100);
      }
    };

    // Listen for all style changes
    mapInstance.on("style.load", handleStyleLoad);

    // IMPORTANT: Also add traffic now if style is already loaded and traffic is enabled
    // This handles the initial load case where style.load may have already fired
    if (showTrafficRef.current && mapInstance.isStyleLoaded()) {
      addTrafficLayer();
    }

    return () => {
      mapInstance.off("style.load", handleStyleLoad);
    };
  }, [mapLoaded]);

  // Toggle traffic layer on/off based on showTraffic prop
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const mapInstance = map.current;

    const addTrafficLayer = () => {
      if (!mapInstance.isStyleLoaded()) return;
      
      try {
        if (!mapInstance.getSource("mapbox-traffic")) {
          mapInstance.addSource("mapbox-traffic", {
            type: "vector",
            url: "mapbox://mapbox.mapbox-traffic-v1",
          });
        }

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
      } catch (e) {
        console.log("Error adding traffic layer:", e);
      }
    };

    const removeTrafficLayer = () => {
      try {
        if (mapInstance.getLayer("traffic-layer")) {
          mapInstance.removeLayer("traffic-layer");
        }
        if (mapInstance.getSource("mapbox-traffic")) {
          mapInstance.removeSource("mapbox-traffic");
        }
      } catch (e) {
        console.log("Error removing traffic layer:", e);
      }
    };

    if (showTraffic) {
      if (mapInstance.isStyleLoaded()) {
        addTrafficLayer();
      }
    } else {
      if (mapInstance.isStyleLoaded()) {
        removeTrafficLayer();
      }
    }
  }, [showTraffic, mapLoaded]);

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

  // Alert radius circle (dev mode)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const mapInstance = map.current;
    const sourceId = "alert-radius-source";
    const layerId = "alert-radius-layer";
    const outlineLayerId = "alert-radius-outline";

    // Helper to create circle polygon from center point and radius in meters
    const createCirclePolygon = (lng: number, lat: number, radiusMeters: number, points = 64) => {
      const coords = [];
      const earthRadius = 6371000; // meters
      const latRad = (lat * Math.PI) / 180;
      
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * 2 * Math.PI;
        const dx = radiusMeters * Math.cos(angle);
        const dy = radiusMeters * Math.sin(angle);
        
        const newLat = lat + (dy / earthRadius) * (180 / Math.PI);
        const newLng = lng + (dx / (earthRadius * Math.cos(latRad))) * (180 / Math.PI);
        
        coords.push([newLng, newLat]);
      }
      
      return {
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [coords],
        },
        properties: {},
      };
    };

    // Remove existing layers and source if they exist
    const removeExisting = () => {
      if (mapInstance.getLayer(outlineLayerId)) {
        mapInstance.removeLayer(outlineLayerId);
      }
      if (mapInstance.getLayer(layerId)) {
        mapInstance.removeLayer(layerId);
      }
      if (mapInstance.getSource(sourceId)) {
        mapInstance.removeSource(sourceId);
      }
    };

    // If not showing or no user location, remove and return
    if (!showAlertRadius || !userLocation || alertRadiusMeters === 0) {
      removeExisting();
      return;
    }

    const circleData = createCirclePolygon(
      userLocation.longitude,
      userLocation.latitude,
      alertRadiusMeters
    );

    // Check if source exists
    const existingSource = mapInstance.getSource(sourceId) as mapboxgl.GeoJSONSource;
    
    if (existingSource) {
      // Update existing source
      existingSource.setData({
        type: "FeatureCollection",
        features: [circleData],
      });
    } else {
      // Create new source and layers
      mapInstance.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [circleData],
        },
      });

      // Add fill layer (semi-transparent)
      mapInstance.addLayer({
        id: layerId,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": "#3b82f6",
          "fill-opacity": 0.1,
        },
      });

      // Add outline layer (dashed)
      mapInstance.addLayer({
        id: outlineLayerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#3b82f6",
          "line-width": 2,
          "line-dasharray": [4, 4],
          "line-opacity": 0.6,
        },
      });
    }

    // Cleanup on unmount
    return () => {
      // Don't remove on every re-render, only when actually unmounting
    };
  }, [showAlertRadius, alertRadiusMeters, userLocation, mapLoaded]);

  // Cleanup alert radius on unmount or when disabled
  useEffect(() => {
    return () => {
      if (!map.current) return;
      const mapInstance = map.current;
      const sourceId = "alert-radius-source";
      const layerId = "alert-radius-layer";
      const outlineLayerId = "alert-radius-outline";
      
      try {
        if (mapInstance.getLayer(outlineLayerId)) mapInstance.removeLayer(outlineLayerId);
        if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
        if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId);
      } catch {
        // Ignore errors during cleanup
      }
    };
  }, []);

  // Dev mode - Show cached Waze tile bounds
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const mapInstance = map.current;
    
    const sourceId = "debug-tile-bounds-source";
    const fillLayerId = "debug-tile-bounds-fill";
    const lineLayerId = "debug-tile-bounds-line";
    const labelLayerId = "debug-tile-bounds-label";

    // Remove existing layers and source
    try {
      if (mapInstance.getLayer(labelLayerId)) mapInstance.removeLayer(labelLayerId);
      if (mapInstance.getLayer(lineLayerId)) mapInstance.removeLayer(lineLayerId);
      if (mapInstance.getLayer(fillLayerId)) mapInstance.removeLayer(fillLayerId);
      if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId);
    } catch {
      // Ignore cleanup errors
    }

    // If no debug tiles, don't render anything
    if (!debugTileBounds || debugTileBounds.length === 0) return;

    // Create GeoJSON features for each tile
    const features = debugTileBounds.map((tile, index) => {
      const { bounds, ageMs } = tile;
      const ageSeconds = Math.round(ageMs / 1000);
      // Color based on age: green (fresh) -> yellow -> red (old)
      const freshness = Math.max(0, 1 - ageMs / 60000); // 0-1, 1 = fresh
      
      return {
        type: "Feature" as const,
        properties: {
          index,
          ageSeconds,
          freshness,
          label: `Tile ${index + 1}\n${ageSeconds}s old`,
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [[
            [bounds.west, bounds.south],
            [bounds.east, bounds.south],
            [bounds.east, bounds.north],
            [bounds.west, bounds.north],
            [bounds.west, bounds.south],
          ]],
        },
      };
    });

    // Add source
    mapInstance.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features,
      },
    });

    // Add fill layer (semi-transparent)
    mapInstance.addLayer({
      id: fillLayerId,
      type: "fill",
      source: sourceId,
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["get", "freshness"],
          0, "#ef4444", // red (stale)
          0.5, "#eab308", // yellow
          1, "#22c55e", // green (fresh)
        ],
        "fill-opacity": 0.15,
      },
    });

    // Add outline layer
    mapInstance.addLayer({
      id: lineLayerId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": [
          "interpolate",
          ["linear"],
          ["get", "freshness"],
          0, "#ef4444",
          0.5, "#eab308",
          1, "#22c55e",
        ],
        "line-width": 3,
        "line-dasharray": [4, 2],
      },
    });

    // Add label layer
    mapInstance.addLayer({
      id: labelLayerId,
      type: "symbol",
      source: sourceId,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 14,
        "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
        "text-anchor": "center",
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#000000",
        "text-halo-width": 2,
      },
    });
  }, [debugTileBounds, mapLoaded]);

  // Update alert markers with clustering - incremental updates to prevent popup glitches
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Theme-aware colors
    const shadowColor = isDarkMode ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.15)";
    const popupBg = isDarkMode ? "#1a1a1a" : "white";
    const popupText = isDarkMode ? "#e5e5e5" : "#374151";
    const popupSubtext = isDarkMode ? "#9ca3af" : "#6b7280";

    // Cluster nearby alerts
    const clusters = clusterAlerts(alerts);
    
    // Generate stable IDs for clusters/alerts
    const getClusterId = (cluster: AlertCluster): string => {
      if (cluster.alerts.length === 1) {
        return cluster.alerts[0].uuid;
      }
      // For clusters, use sorted UUIDs to create stable ID
      return `cluster-${cluster.alerts.map(a => a.uuid).sort().join('-')}`;
    };
    
    // Track which markers should exist
    const newMarkerIds = new Set<string>();
    
    // Track which marker has an open popup (to preserve it)
    let openPopupMarkerId: string | null = null;
    for (const [id, marker] of markersRef.current) {
      if (marker.getPopup()?.isOpen()) {
        openPopupMarkerId = id;
        break;
      }
    }

    clusters.forEach((cluster) => {
      const markerId = getClusterId(cluster);
      newMarkerIds.add(markerId);
      
      const isCluster = cluster.alerts.length > 1;
      const color = ALERT_COLORS[cluster.mostSevereType] || "#6b7280";
      const icon = ALERT_ICONS[cluster.mostSevereType] || "/icons/hazard.svg";
      
      // Check if marker already exists
      const existingMarker = markersRef.current.get(markerId);
      
      if (existingMarker) {
        // Update position if needed (marker exists, just update location)
        const currentLngLat = existingMarker.getLngLat();
        const targetLng = isCluster ? cluster.center.x : cluster.alerts[0].location.x;
        const targetLat = isCluster ? cluster.center.y : cluster.alerts[0].location.y;
        
        if (Math.abs(currentLngLat.lng - targetLng) > 0.00001 || 
            Math.abs(currentLngLat.lat - targetLat) > 0.00001) {
          existingMarker.setLngLat([targetLng, targetLat]);
        }
        return; // Keep existing marker, don't recreate
      }
      
      // Create new marker
      const el = document.createElement("div");
      el.className = "alert-marker";

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
              <img src="${icon}" alt="${cluster.mostSevereType}" style="width: 44px; height: auto;${!isDarkMode ? ' filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));' : ''}" />
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

        markersRef.current.set(markerId, marker);
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
              <img src="${icon}" alt="${alert.type}" style="width: 36px; height: auto;${!isDarkMode ? ' filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));' : ''}" />
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

        markersRef.current.set(markerId, marker);
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
    
    // Remove markers that no longer exist (only remove stale ones)
    for (const [id, marker] of markersRef.current) {
      if (!newMarkerIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
    
    // If there was an open popup and the marker still exists, keep it open
    // (no action needed - we preserved the marker so popup stays open)
  }, [alerts, mapLoaded, isDarkMode]);

  // Update speed camera markers - incremental updates to prevent popup glitches
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Theme-aware colors
    const popupBg = isDarkMode ? "#1a1a1a" : "white";
    const popupText = isDarkMode ? "#e5e5e5" : "#374151";
    const popupSubtext = isDarkMode ? "#9ca3af" : "#6b7280";
    
    // Track which markers should exist
    const newCameraIds = new Set<string>();

    speedCameras.forEach((camera) => {
      // Use camera ID or generate from coordinates
      const cameraId = camera.id || `camera-${camera.location.lat.toFixed(6)}-${camera.location.lon.toFixed(6)}`;
      newCameraIds.add(cameraId);
      
      // Check if marker already exists
      const existingMarker = cameraMarkersRef.current.get(cameraId);
      
      if (existingMarker) {
        // Update position if needed
        const currentLngLat = existingMarker.getLngLat();
        if (Math.abs(currentLngLat.lng - camera.location.lon) > 0.00001 || 
            Math.abs(currentLngLat.lat - camera.location.lat) > 0.00001) {
          existingMarker.setLngLat([camera.location.lon, camera.location.lat]);
        }
        return; // Keep existing marker, don't recreate
      }
      
      // Create new marker
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
            <img src="${icon}" alt="${cameraTypeLabel}" style="width: 36px; height: auto;${!isDarkMode ? ' filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));' : ''}" />
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

      cameraMarkersRef.current.set(cameraId, marker);

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
    
    // Remove markers that no longer exist
    for (const [id, marker] of cameraMarkersRef.current) {
      if (!newCameraIds.has(id)) {
        marker.remove();
        cameraMarkersRef.current.delete(id);
      }
    }
  }, [speedCameras, mapLoaded, isDarkMode]);

  // Render other users as car markers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const currentMarkers = otherUserMarkersRef.current;
    const userIds = new Set(otherUsers.map((u) => u.id));

    // Remove markers for users who left
    for (const [id, marker] of currentMarkers) {
      if (!userIds.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    }

    // Add or update markers for each user
    otherUsers.forEach((user) => {
      const existingMarker = currentMarkers.get(user.id);
      const carIconPath = `/cars/${user.c}.png`;
      const rotation = user.h ?? 0;

      if (existingMarker) {
        // Update position - setLngLat positions the marker at geographic coordinates
        existingMarker.setLngLat([user.lng, user.lat]);
        // Update rotation
        const el = existingMarker.getElement();
        const carEl = el.querySelector(".other-user-car") as HTMLElement;
        if (carEl) {
          carEl.style.transform = `rotate(${rotation}deg)`;
        }
      } else {
        // Create new marker - structure similar to user marker for consistent behavior
        const el = document.createElement("div");
        el.className = "other-user-marker";
        
        // Use a container-based approach like the user marker
        // This ensures the marker is properly geo-positioned and doesn't scale with zoom
        el.innerHTML = `
          <div class="other-user-container">
            <div class="other-user-car" style="transform: rotate(${rotation}deg);">
            <img 
              src="${carIconPath}" 
              alt="Other driver" 
              onerror="this.src='/cars/blue.png'"
            />
          </div>
            <div class="other-user-shadow"></div>
          </div>
        `;

        // Create marker without explicit anchor - let CSS handle centering
        // This matches the user marker pattern which works correctly
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([user.lng, user.lat])
          .addTo(map.current!);

        currentMarkers.set(user.id, marker);
      }
    });
  }, [otherUsers, mapLoaded]);

  // Cleanup other user markers on unmount
  useEffect(() => {
    return () => {
      for (const marker of otherUserMarkersRef.current.values()) {
        marker.remove();
      }
      otherUserMarkersRef.current.clear();
    };
  }, []);

  // Pin marker for long-press location (using Waze origin marker style)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove existing pin marker
    if (pinMarkerRef.current) {
      pinMarkerRef.current.remove();
      pinMarkerRef.current = null;
    }

    // Create new pin marker if location is set
    if (pinLocation) {
      const el = document.createElement("div");
      el.className = "pin-marker";
      el.innerHTML = `
        <div class="pin-marker-container" style="
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
          animation: pin-pulse 1.5s ease-in-out infinite;
        ">
          <svg width="32" height="32" fill="none" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
            <circle cx="11" cy="11" r="11" fill="#fff"/>
            <circle cx="11" cy="11" r="6.5" fill="#fff" stroke="#0099ff" stroke-width="4"/>
          </svg>
        </div>
      `;

      pinMarkerRef.current = new mapboxgl.Marker({ 
        element: el, 
        anchor: "center" 
      })
        .setLngLat([pinLocation.lng, pinLocation.lat])
        .addTo(map.current);
    }
  }, [pinLocation, mapLoaded]);

  // Route line display - supports multiple routes with selection
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const mapInstance = map.current;
    
    // Use routes array if provided, otherwise fall back to single route
    const allRoutes = routes.length > 0 ? routes : (route ? [route] : []);
    
    // Function to remove all existing route layers
    const removeAllRouteLayers = () => {
      // Remove up to 5 possible route layers (more than we'll ever need)
      for (let i = 0; i < 5; i++) {
        const layerId = `route-layer-${i}`;
        const casingLayerId = `route-casing-layer-${i}`;
        const sourceId = `route-source-${i}`;
        
        if (mapInstance.getLayer(layerId)) {
          mapInstance.removeLayer(layerId);
        }
        if (mapInstance.getLayer(casingLayerId)) {
          mapInstance.removeLayer(casingLayerId);
        }
        if (mapInstance.getSource(sourceId)) {
          mapInstance.removeSource(sourceId);
        }
      }
      
      // Also remove legacy single route layers
      if (mapInstance.getLayer("route-layer")) {
        mapInstance.removeLayer("route-layer");
      }
      if (mapInstance.getLayer("route-casing-layer")) {
        mapInstance.removeLayer("route-casing-layer");
      }
      if (mapInstance.getSource("route-source")) {
        mapInstance.removeSource("route-source");
      }
    };

    // Function to add all routes
    const addRoutes = () => {
      if (allRoutes.length === 0) return;
      
      // Add alternative routes first (so they appear behind selected route)
      allRoutes.forEach((routeData, index) => {
        if (index === selectedRouteIndex) return; // Skip selected route, add it last
        
        const sourceId = `route-source-${index}`;
        const casingLayerId = `route-casing-layer-${index}`;
        const layerId = `route-layer-${index}`;
        
        // Add source
        mapInstance.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString" as const,
              coordinates: routeData.geometry.coordinates,
            },
          },
        });

        // Add casing (outline) - gray for alternatives
        mapInstance.addLayer({
          id: casingLayerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": isDarkMode ? "#1a1a1a" : "#ffffff",
            "line-width": 8,
            "line-opacity": 0.6,
          },
        });

        // Add route line - gray/muted for alternatives
        mapInstance.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": isDarkMode ? "#6b7280" : "#9ca3af", // Gray for alternatives
            "line-width": 5,
            "line-opacity": 0.7,
          },
        });
      });

      // Add selected route last (so it appears on top)
      const selectedRoute = allRoutes[selectedRouteIndex];
      if (selectedRoute) {
        const sourceId = `route-source-${selectedRouteIndex}`;
        const casingLayerId = `route-casing-layer-${selectedRouteIndex}`;
        const layerId = `route-layer-${selectedRouteIndex}`;
        
        // Add source
        mapInstance.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString" as const,
              coordinates: selectedRoute.geometry.coordinates,
            },
          },
        });

        // Add casing (outline) for better visibility
        mapInstance.addLayer({
          id: casingLayerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": isDarkMode ? "#1a1a1a" : "#ffffff",
            "line-width": 10,
            "line-opacity": 0.8,
          },
        });

        // Add route line - blue for selected
        mapInstance.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": "#3b82f6", // Blue for selected route
            "line-width": 6,
            "line-opacity": 1,
          },
        });

        // Fit map to show the selected route
        const coordinates = selectedRoute.geometry.coordinates;
        if (coordinates.length > 0) {
          const bounds = coordinates.reduce(
            (bnds, coord) => bnds.extend(coord as [number, number]),
            new mapboxgl.LngLatBounds(coordinates[0] as [number, number], coordinates[0] as [number, number])
          );

          mapInstance.fitBounds(bounds, {
            padding: { top: 100, bottom: 250, left: 50, right: 50 },
            duration: 1000,
          });
        }
      }
    };

    // Remove existing routes and add new ones
    removeAllRouteLayers();
    addRoutes();

    // Cleanup on style change
    const handleStyleLoad = () => {
      removeAllRouteLayers();
      addRoutes();
    };

    mapInstance.on("style.load", handleStyleLoad);

    return () => {
      mapInstance.off("style.load", handleStyleLoad);
    };
  }, [route, routes, selectedRouteIndex, mapLoaded, isDarkMode]);

  return (
    <>
      <div
        ref={mapContainer}
        className="w-full h-full"
        style={{ position: "absolute", inset: 0 }}
      />
      {/* Night overlay for satellite map - darkens based on time of day */}
      {useSatellite && nightOverlayOpacity > 0 && (
        <div
          className="pointer-events-none"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: `rgba(0, 0, 20, ${nightOverlayOpacity})`,
            transition: "background-color 60s ease-in-out",
            zIndex: 1,
          }}
        />
      )}
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
        
        .pin-marker {
          z-index: 15 !important;
        }
        
        @keyframes pin-pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
        }
        
        .other-user-marker {
          z-index: 5 !important;
        }
        
        .other-user-container {
          position: relative;
          width: 32px;
          height: 40px;
        }
        
        .other-user-car {
          position: absolute;
          top: 50%;
          left: 50%;
          margin-left: -9px;
          margin-top: -14px;
          width: 18px;
          height: 28px;
          transition: transform 0.3s ease-out;
        }
        
        .other-user-car img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        
        .other-user-shadow {
          position: absolute;
          top: 50%;
          left: 50%;
          margin-left: -10px;
          margin-top: -10px;
          width: 20px;
          height: 20px;
          background: radial-gradient(ellipse, rgba(0,0,0,0.15) 0%, transparent 70%);
          border-radius: 50%;
          z-index: -1;
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