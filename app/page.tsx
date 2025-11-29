"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Map, type MapRef } from "@/components/Map";
import { SettingsModal } from "@/components/SettingsModal";
import { NavigateSearch } from "@/components/NavigateSearch";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useWazeAlerts } from "@/hooks/useWazeAlerts";
import { useSpeedCameras } from "@/hooks/useSpeedCameras";
import { useReverseGeocode } from "@/hooks/useReverseGeocode";
import type { MapBounds } from "@/types/waze";
import type { RouteData } from "@/types/route";
import Image from "next/image";
import posthog from "posthog-js";
import { ShieldExclamationIcon, ExclamationTriangleIcon, NoSymbolIcon } from "@heroicons/react/24/solid";

// Consistent button styles for light/dark mode - more transparent with blur
const getButtonStyles = (darkMode: boolean) => 
  darkMode 
    ? "bg-[#1a1a1a]/50 text-white border-white/10" 
    : "bg-white/50 text-black border-black/10";

const getContainerStyles = (darkMode: boolean) =>
  darkMode
    ? "bg-[#1a1a1a]/50 text-white border-white/10"
    : "bg-white/50 text-black border-black/10";

// Format duration in seconds to human-readable string
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} min`;
}

// Format distance in meters to human-readable string
function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  if (miles >= 10) {
    return `${Math.round(miles)} mi`;
  }
  return `${miles.toFixed(1)} mi`;
}

export default function Home() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [followMode, setFollowMode] = useState(false);
  const [isCentered, setIsCentered] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showWazeAlerts, setShowWazeAlerts] = useState(true);
  const [showSpeedCameras, setShowSpeedCameras] = useState(true);
  const [showTraffic, setShowTraffic] = useState(true);
  const [useSatellite, setUseSatellite] = useState(false);
  const [showAvatarPulse, setShowAvatarPulse] = useState(true);
  const mapRef = useRef<MapRef>(null);

  const [destination, setDestination] = useState<{ lng: number; lat: number; name: string } | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ lng: number; lat: number; screenX: number; screenY: number; placeName?: string } | null>(null);
  const [contextMenuLoading, setContextMenuLoading] = useState(false);
  // Preview location - shown on map when user searches but hasn't started navigation yet
  const [previewLocation, setPreviewLocation] = useState<{ lng: number; lat: number; name: string } | null>(null);
  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  const [dismissedMobileWarning, setDismissedMobileWarning] = useState(false);

  const { latitude, longitude, heading, effectiveHeading, loading: geoLoading, error: geoError } = useGeolocation();
  const { alerts, loading: alertsLoading } = useWazeAlerts({ bounds });
  const { cameras } = useSpeedCameras({ bounds, enabled: showSpeedCameras });
  const { placeName, loading: placeLoading } = useReverseGeocode(latitude, longitude);

  // Track last route origin to detect significant movement
  const lastRouteOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const routeUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ROUTE_UPDATE_DISTANCE_THRESHOLD = 50; // meters - recalculate if user moves this far
  const ROUTE_UPDATE_DEBOUNCE = 2000; // ms - minimum time between route updates

  // Calculate distance between two coordinates in meters (Haversine formula)
  const getDistanceInMeters = useCallback((lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }, []);

  // Fetch route when destination is set
  const fetchRoute = useCallback(async (destLng: number, destLat: number, isUpdate = false) => {
    if (!latitude || !longitude) return;
    
    // Only show loading indicator for initial route, not updates
    if (!isUpdate) {
      setRouteLoading(true);
    }
    
    try {
      const response = await fetch(
        `/api/directions?originLng=${longitude}&originLat=${latitude}&destLng=${destLng}&destLat=${destLat}`
      );
      
      if (response.ok) {
        const routeData: RouteData = await response.json();
        setRoute(routeData);
        
        // Update last origin
        lastRouteOriginRef.current = { lat: latitude, lng: longitude };
        
        if (!isUpdate) {
          posthog.capture("route_calculated", {
            distance_meters: routeData.distance,
            duration_seconds: routeData.duration,
          });
        }
      } else {
        console.error("Failed to fetch route");
        if (!isUpdate) setRoute(null);
      }
    } catch (error) {
      console.error("Route fetch error:", error);
      if (!isUpdate) setRoute(null);
    } finally {
      if (!isUpdate) {
        setRouteLoading(false);
      }
    }
  }, [latitude, longitude]);

  // Recalculate route when user moves significantly during navigation
  useEffect(() => {
    if (!destination || !latitude || !longitude || !lastRouteOriginRef.current) return;
    
    const distanceMoved = getDistanceInMeters(
      lastRouteOriginRef.current.lat,
      lastRouteOriginRef.current.lng,
      latitude,
      longitude
    );
    
    // Only recalculate if user has moved beyond threshold
    if (distanceMoved >= ROUTE_UPDATE_DISTANCE_THRESHOLD) {
      // Clear any pending update
      if (routeUpdateTimeoutRef.current) {
        clearTimeout(routeUpdateTimeoutRef.current);
      }
      
      // Debounce the route update
      routeUpdateTimeoutRef.current = setTimeout(() => {
        fetchRoute(destination.lng, destination.lat, true);
      }, ROUTE_UPDATE_DEBOUNCE);
    }
    
    return () => {
      if (routeUpdateTimeoutRef.current) {
        clearTimeout(routeUpdateTimeoutRef.current);
      }
    };
  }, [latitude, longitude, destination, fetchRoute, getDistanceInMeters]);

  // Handle destination selection from search - just preview, don't navigate yet
  const handleSelectDestination = useCallback((lng: number, lat: number, placeName: string) => {
    setPreviewLocation({ lng, lat, name: placeName });
    setContextMenu(null);
    // Center map on the searched location
    if (mapRef.current) {
      mapRef.current.recenter(lng, lat);
    }
    posthog.capture("location_previewed", {
      place_name: placeName,
    });
  }, []);

  // Actually start navigation from preview location
  const handleStartNavigation = useCallback(() => {
    if (!previewLocation) return;
    
    setDestination(previewLocation);
    setPreviewLocation(null);
    // Reset last origin so the first fetch sets it
    lastRouteOriginRef.current = null;
    fetchRoute(previewLocation.lng, previewLocation.lat);
    
    posthog.capture("navigation_started_from_preview", {
      place_name: previewLocation.name,
    });
  }, [previewLocation, fetchRoute]);

  // Cancel preview and return to user location
  const handleCancelPreview = useCallback(() => {
    setPreviewLocation(null);
    // Return to user's location
    if (latitude && longitude && mapRef.current) {
      mapRef.current.recenter(longitude, latitude);
    }
  }, [latitude, longitude]);

  // Clear destination
  const handleClearDestination = useCallback(() => {
    setDestination(null);
    setRoute(null);
    setPreviewLocation(null);
    lastRouteOriginRef.current = null;
    if (routeUpdateTimeoutRef.current) {
      clearTimeout(routeUpdateTimeoutRef.current);
    }
    if (latitude && longitude && mapRef.current) {
      mapRef.current.recenter(longitude, latitude);
    }
  }, [latitude, longitude]);

  // Handle long press on map
  const handleMapLongPress = useCallback(async (lng: number, lat: number, screenX: number, screenY: number) => {
    setContextMenuLoading(true);
    setContextMenu({ lng, lat, screenX, screenY });

    // Reverse geocode to get place name
    try {
      const response = await fetch(
        `/api/geocode/reverse?lng=${lng}&lat=${lat}`
      );
      if (response.ok) {
        const data = await response.json();
        setContextMenu({ lng, lat, screenX, screenY, placeName: data.placeName });
      }
    } catch (error) {
      console.error("Reverse geocode error:", error);
    } finally {
      setContextMenuLoading(false);
    }
  }, []);

  // Navigate to long-pressed location (direct navigation since user already confirmed)
  const handleNavigateToContextMenu = useCallback(() => {
    if (contextMenu) {
      const name = contextMenu.placeName || `${contextMenu.lat.toFixed(4)}, ${contextMenu.lng.toFixed(4)}`;
      
      // Direct navigation - set destination and fetch route immediately
      setDestination({ lng: contextMenu.lng, lat: contextMenu.lat, name });
      setContextMenu(null);
      setPreviewLocation(null); // Clear any preview
      lastRouteOriginRef.current = null;
      fetchRoute(contextMenu.lng, contextMenu.lat);
      
      posthog.capture("navigate_from_long_press", {
        place_name: name,
        coordinates: { lng: contextMenu.lng, lat: contextMenu.lat },
      });
    }
  }, [contextMenu, fetchRoute]);

  // Close context menu
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Load settings from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedSatellite = localStorage.getItem("teslanav-satellite");
      if (savedSatellite !== null) {
        setUseSatellite(savedSatellite === "true");
      }
      const savedTraffic = localStorage.getItem("teslanav-traffic");
      if (savedTraffic !== null) {
        setShowTraffic(savedTraffic === "true");
      }
    }
  }, []);

  // Detect mobile devices (but not Tesla browser)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const userAgent = navigator.userAgent.toLowerCase();
      // Check if it's a Tesla browser (Tesla browsers identify themselves)
      const isTeslaBrowser = userAgent.includes("tesla") || userAgent.includes("qtcarbrowser");
      // Check if it's a mobile device
      const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
      // Also check screen width as a fallback
      const isSmallScreen = window.innerWidth < 768;
      
      // Show warning if mobile and NOT Tesla browser
      setIsMobile((isMobileDevice || isSmallScreen) && !isTeslaBrowser);
      
      // Check if user previously dismissed the warning
      const dismissed = localStorage.getItem("teslanav-mobile-dismissed");
      if (dismissed === "true") {
        setDismissedMobileWarning(true);
      }
    }
  }, []);

  // Save satellite preference to localStorage
  const handleToggleSatellite = useCallback((value: boolean) => {
    setUseSatellite(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("teslanav-satellite", value.toString());
    }
  }, []);

  // Save traffic preference to localStorage
  const handleToggleTraffic = useCallback((value: boolean) => {
    setShowTraffic(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("teslanav-traffic", value.toString());
    }
  }, []);

  // Check system dark mode preference
  useEffect(() => {
    if (typeof window !== "undefined") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setIsDarkMode(prefersDark);

      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, []);

  const handleBoundsChange = useCallback((newBounds: MapBounds) => {
    setBounds(newBounds);
  }, []);

  // Callback from Map when centering state changes (user pans away or recenters)
  const handleCenteredChange = useCallback((centered: boolean) => {
    setIsCentered(centered);
  }, []);

  const handleRecenter = useCallback(() => {
    if (latitude && longitude && mapRef.current) {
      mapRef.current.recenter(longitude, latitude);
      // Map component will call onCenteredChange(true)

      // Track recenter event
      posthog.capture("map_recentered", {
        latitude,
        longitude,
        follow_mode: followMode,
      });
    }
  }, [latitude, longitude, followMode]);

  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((prev) => {
      const newValue = !prev;

      // Track dark mode toggle
      posthog.capture("dark_mode_toggled", {
        dark_mode_enabled: newValue,
      });

      return newValue;
    });
  }, []);

  const toggleFollowMode = useCallback(() => {
    setFollowMode((prev) => {
      const newValue = !prev;
      if (mapRef.current) {
        mapRef.current.setFollowMode(newValue);
      }

      // Track follow mode toggle
      posthog.capture("follow_mode_toggled", {
        follow_mode_enabled: newValue,
      });

      return newValue;
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn();

    // Track zoom in event
    posthog.capture("map_zoomed_in");
  }, []);

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut();

    // Track zoom out event
    posthog.capture("map_zoomed_out");
  }, []);

  // Filter alerts to show only key types (if enabled)
  const filteredAlerts = showWazeAlerts
    ? alerts.filter((alert) =>
        ["POLICE", "ACCIDENT", "HAZARD", "ROAD_CLOSED"].includes(alert.type)
      )
    : [];

  // Count by type for display
  const alertCounts = {
    police: filteredAlerts.filter((a) => a.type === "POLICE").length,
    accidents: filteredAlerts.filter((a) => a.type === "ACCIDENT").length,
    hazards: filteredAlerts.filter((a) => a.type === "HAZARD").length,
    closures: filteredAlerts.filter((a) => a.type === "ROAD_CLOSED").length,
  };

  // Show refocus button when not centered (regardless of rotation mode)
  const showRefocusButton = !isCentered && latitude && longitude;

  // Use dark theme for UI when satellite mode is on
  const effectiveDarkMode = isDarkMode || useSatellite;

  // Compass colors based on theme
  const compassCircleColor = effectiveDarkMode ? "#6b7280" : "#9ca3af";
  const compassNeedleColor = followMode ? "#3b82f6" : (effectiveDarkMode ? "#d1d5db" : "#374151");
  const compassCenterFill = effectiveDarkMode ? "#1a1a1a" : "white";
  const compassCenterStroke = effectiveDarkMode ? "#9ca3af" : "#374151";

  return (
    <main className="relative w-full h-full">
      {/* Map */}
      <Map
        ref={mapRef}
        zoom={14}
        isDarkMode={effectiveDarkMode}
        alerts={filteredAlerts}
        speedCameras={showSpeedCameras ? cameras : []}
        onBoundsChange={handleBoundsChange}
        onCenteredChange={handleCenteredChange}
        onLongPress={handleMapLongPress}
        pinLocation={contextMenu ? { lng: contextMenu.lng, lat: contextMenu.lat } : previewLocation ? { lng: previewLocation.lng, lat: previewLocation.lat } : null}
        route={route}
        userLocation={latitude && longitude ? { latitude, longitude, heading, effectiveHeading } : null}
        followMode={followMode}
        showTraffic={showTraffic}
        useSatellite={useSatellite}
        showAvatarPulse={showAvatarPulse}
      />

      {/* Context Menu - Shows on long press */}
      {contextMenu && (() => {
        // Smart positioning: show below pin if in upper half, above pin if in lower half
        const isUpperHalf = contextMenu.screenY < window.innerHeight / 2;
        const menuHeight = 180; // approximate menu height
        const pinOffset = 40; // space between pin and menu
        
        // Calculate horizontal position (keep menu on screen)
        const menuWidth = 280;
        let leftPos = contextMenu.screenX;
        // Clamp to keep menu on screen horizontally
        leftPos = Math.max(menuWidth / 2 + 16, Math.min(leftPos, window.innerWidth - menuWidth / 2 - 16));
        
        return (
        <div className="absolute inset-0 z-40" onClick={handleCloseContextMenu}>
          <div 
            className="absolute -translate-x-1/2"
            style={{ 
              left: leftPos,
              ...(isUpperHalf 
                ? { top: contextMenu.screenY + pinOffset }
                : { top: contextMenu.screenY - pinOffset - menuHeight }
              ),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`
                rounded-2xl backdrop-blur-xl shadow-2xl border overflow-hidden
                ${effectiveDarkMode ? "bg-[#1a1a1a]/95 text-white border-white/10" : "bg-white/95 text-black border-black/10"}
                min-w-[280px]
              `}
            >
              {/* Location info */}
              <div className="px-5 py-4 border-b border-inherit">
                <div className={`text-xs uppercase tracking-wider mb-1 ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Selected Location
                </div>
                <div className="text-sm font-medium">
                  {contextMenuLoading ? (
                    <span className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin opacity-50" />
                      Finding address...
                    </span>
                  ) : (
                    contextMenu.placeName || `${contextMenu.lat.toFixed(4)}, ${contextMenu.lng.toFixed(4)}`
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="p-2">
                <button
                  onClick={handleNavigateToContextMenu}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-xl
                    ${effectiveDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"}
                    transition-colors text-left
                  `}
                >
                  <NavigateToIcon className={`w-5 h-5 ${effectiveDarkMode ? "text-blue-400" : "text-blue-500"}`} />
                  <span className="font-medium">Navigate here</span>
                </button>
                <button
                  onClick={handleCloseContextMenu}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-xl
                    ${effectiveDarkMode ? "hover:bg-white/10 text-gray-400" : "hover:bg-black/5 text-gray-500"}
                    transition-colors text-left
                  `}
                >
                  <CloseNavIcon className="w-5 h-5" />
                  <span className="font-medium">Cancel</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Top Left - Navigate Search + Destination Card */}
      <div className="absolute top-4 left-4 z-30 flex flex-col gap-3">
        <NavigateSearch
          isDarkMode={effectiveDarkMode}
          onSelectDestination={handleSelectDestination}
          onOpenChange={setIsSearchOpen}
          userLocation={latitude && longitude ? { latitude, longitude } : null}
        />

        {/* Preview Card - Shows when a location is searched but not navigating yet */}
        {previewLocation && !destination && !isSearchOpen && (
          <div
            className={`
              rounded-2xl backdrop-blur-xl overflow-hidden
              ${getContainerStyles(effectiveDarkMode)}
              shadow-lg border max-w-[360px]
            `}
          >
            {/* Location info */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-inherit">
              <LocationSearchIcon className={`w-5 h-5 flex-shrink-0 ${effectiveDarkMode ? "text-blue-400" : "text-blue-500"}`} />
              <div className="flex-1 min-w-0">
                <div className={`text-xs uppercase tracking-wider ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Search Result
                </div>
                <div className="text-sm font-medium truncate">{previewLocation.name}</div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 p-3">
              <button
                onClick={handleStartNavigation}
                className={`
                  flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                  bg-blue-500 text-white font-medium
                  transition-all hover:bg-blue-600 active:scale-[0.98]
                `}
              >
                <NavigateToIcon className="w-4 h-4" />
                Navigate
              </button>
              <button
                onClick={handleCancelPreview}
                className={`
                  px-4 py-2.5 rounded-xl font-medium
                  ${effectiveDarkMode ? "bg-white/10 hover:bg-white/20" : "bg-black/5 hover:bg-black/10"}
                  transition-all active:scale-[0.98]
                `}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        
        {/* Destination Card - Shows when navigating (hidden while search is open) */}
        {destination && !isSearchOpen && (
          <div
            className={`
              rounded-2xl backdrop-blur-xl overflow-hidden
              ${getContainerStyles(effectiveDarkMode)}
              shadow-lg border max-w-[360px]
            `}
          >
            {/* Route info */}
            {route && (
              <div className="flex items-center gap-4 px-4 py-3 border-b border-inherit">
                <div className="flex items-center gap-2">
                  <ClockIcon className={`w-5 h-5 ${effectiveDarkMode ? "text-blue-400" : "text-blue-500"}`} />
                  <span className="text-lg font-semibold">
                    {formatDuration(route.duration)}
                  </span>
                </div>
                <div className={`text-sm ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  {formatDistance(route.distance)}
                </div>
              </div>
            )}
            {routeLoading && (
              <div className="flex items-center gap-2 px-4 py-3 border-b border-inherit">
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin opacity-50" />
                <span className={`text-sm ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Calculating route...
                </span>
              </div>
            )}
            
            {/* Destination info */}
            <div className="flex items-center gap-3 px-4 py-3">
              <NavigateToIcon className={`w-5 h-5 flex-shrink-0 ${effectiveDarkMode ? "text-blue-400" : "text-blue-500"}`} />
              <div className="flex-1 min-w-0">
                <div className={`text-xs uppercase tracking-wider ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Navigating to
                </div>
                <div className="text-sm font-medium truncate">{destination.name}</div>
              </div>
              <button
                onClick={handleClearDestination}
                className={`
                  p-2 rounded-lg transition-colors
                  ${effectiveDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"}
                `}
                aria-label="Clear destination"
              >
                <CloseNavIcon className="w-5 h-5 opacity-60" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Top Right - Compass + Alert Summary (stacked) */}
      <div className="absolute top-4 right-4 z-30 flex flex-col items-end gap-3">
        {/* Compass/Orientation Toggle */}
        <button
          onClick={toggleFollowMode}
          className={`
            w-[72px] h-[72px] rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label={followMode ? "Lock north up" : "Follow heading"}
        >
          <div className="relative w-11 h-11">
            {/* Compass icon */}
            <svg viewBox="0 0 24 24" className="w-full h-full">
              {/* Outer circle */}
              <circle cx="12" cy="12" r="10" fill="none" stroke={compassCircleColor} strokeWidth="1" />
              {/* N marker */}
              <text x="12" y="5" textAnchor="middle" fontSize="5" fill="#f59e0b" fontWeight="bold">N</text>
              {/* Arrow/needle */}
              <path
                d="M12 6 L14 12 L12 18 L10 12 Z"
                fill={compassNeedleColor}
                className="transition-colors duration-200"
              />
              {/* Center dot */}
              <circle cx="12" cy="12" r="1.5" fill={compassCenterFill} stroke={compassCenterStroke} strokeWidth="0.5" />
            </svg>
            {/* Active indicator */}
            {followMode && (
              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-blue-500 rounded-full border-2 border-white" />
            )}
          </div>
        </button>

        {/* Alert Summary - Stacked vertically, same width as compass */}
        {filteredAlerts.length > 0 && (
          <div
            className={`
              w-[72px] flex flex-col items-center gap-1.5 py-3 rounded-xl backdrop-blur-xl
              ${getContainerStyles(effectiveDarkMode)}
              shadow-lg border
            `}
          >
            {alertCounts.police > 0 && (
              <span className="flex items-center gap-1.5 text-base">
                <ShieldExclamationIcon className="w-5 h-5 text-blue-500" />
                <span className="font-semibold">{alertCounts.police}</span>
              </span>
            )}
            {alertCounts.accidents > 0 && (
              <span className="flex items-center gap-1.5 text-base">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />
                <span className="font-semibold">{alertCounts.accidents}</span>
              </span>
            )}
            {alertCounts.hazards > 0 && (
              <span className="flex items-center gap-1.5 text-base">
                <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
                <span className="font-semibold">{alertCounts.hazards}</span>
              </span>
            )}
            {alertCounts.closures > 0 && (
              <span className="flex items-center gap-1.5 text-base">
                <NoSymbolIcon className="w-5 h-5 text-gray-500" />
                <span className="font-semibold">{alertCounts.closures}</span>
              </span>
            )}
            {alertsLoading && (
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
            )}
          </div>
        )}
      </div>

      {/* Bottom Left - User Location + Settings */}
      <div className="absolute bottom-6 left-4 z-30 flex items-center gap-3">
        {latitude && longitude && (
          <div
            className={`
              flex items-center gap-3 px-4 py-2.5 rounded-xl backdrop-blur-xl
              ${getContainerStyles(effectiveDarkMode)}
              shadow-lg border
            `}
          >
            <Image
              src={effectiveDarkMode ? "/maps-avatar.jpg" : "/maps-avatar-light.jpg"}
              alt="Your location"
              width={36}
              height={36}
            />
            <div className="flex flex-col">
              <span className={`text-xs uppercase tracking-wider ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Your Location
              </span>
              <span className="text-sm font-medium">
                {placeLoading ? "..." : (placeName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)}
              </span>
              <span className={`text-[10px] ${effectiveDarkMode ? "text-gray-100" : "text-gray-400"}`}>
                v0.1.0
              </span>
            </div>
          </div>
        )}

        {/* Settings Button */}
        <button
          onClick={() => {
            setShowSettings(true);
            // Track settings opened event
            posthog.capture("settings_opened");
          }}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Settings"
        >
          <SettingsIcon className="w-7 h-7" />
        </button>

        {/* Satellite Toggle Button */}
        <button
          onClick={() => {
            handleToggleSatellite(!useSatellite);
            posthog.capture("satellite_quick_toggled", {
              satellite_enabled: !useSatellite,
            });
          }}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${useSatellite 
              ? "bg-blue-500/80 text-white border-blue-400/30" 
              : getButtonStyles(effectiveDarkMode)
            }
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label={useSatellite ? "Switch to standard map" : "Switch to satellite view"}
        >
          <span className="text-3xl leading-none">🛰️</span>
        </button>
      </div>

      {/* Bottom Right - Control Buttons */}
      <div className="absolute bottom-6 right-4 z-30 flex gap-3">
        {/* Refocus Button - Only shows when not centered */}
        {showRefocusButton && (
          <button
            onClick={handleRecenter}
            className={`
              px-6 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center gap-2
              bg-blue-500/80 text-white border-blue-400/30
              shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
            `}
            aria-label="Recenter on location"
          >
            <CrosshairIcon className="w-6 h-6" />
            <span className="text-lg font-medium">Recenter</span>
          </button>
        )}

        {/* Zoom Out */}
        <button
          onClick={handleZoomOut}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Zoom out"
        >
          <MinusIcon className="w-7 h-7" />
        </button>

        {/* Zoom In */}
        <button
          onClick={handleZoomIn}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Zoom in"
        >
          <PlusIcon className="w-7 h-7" />
        </button>

        {/* Dark Mode Toggle */}
        <button
          onClick={toggleDarkMode}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Toggle dark mode"
        >
          {isDarkMode ? (
            <SunIcon className="w-7 h-7" />
          ) : (
            <MoonIcon className="w-7 h-7" />
          )}
        </button>
      </div>

      {/* Loading Overlay - pointer-events-none allows buttons to remain clickable */}
      {geoLoading && !latitude && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-none" />
          <div
            className={`
              relative px-8 py-5 rounded-2xl backdrop-blur-md pointer-events-none
              ${effectiveDarkMode ? "bg-[#1a1a1a]/90 text-white border-white/10" : "bg-white/95 text-black border-black/5"}
              shadow-2xl border
            `}
          >
            <div className="flex items-center gap-4">
              <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span className="text-base font-medium">Finding your location...</span>
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {geoError && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="px-5 py-3 rounded-xl bg-red-500/95 text-white text-base font-medium shadow-lg">
            {geoError}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        isDarkMode={effectiveDarkMode}
        showWazeAlerts={showWazeAlerts}
        onToggleWazeAlerts={setShowWazeAlerts}
        showSpeedCameras={showSpeedCameras}
        onToggleSpeedCameras={setShowSpeedCameras}
        showTraffic={showTraffic}
        onToggleTraffic={handleToggleTraffic}
        useSatellite={useSatellite}
        onToggleSatellite={handleToggleSatellite}
        showAvatarPulse={showAvatarPulse}
        onToggleAvatarPulse={setShowAvatarPulse}
      />

      {/* Hide Mapbox attribution */}
      <style jsx global>{`
        .mapboxgl-ctrl-attrib {
          display: none !important;
        }
      `}</style>

      {/* Mobile Warning Overlay */}
      {isMobile && !dismissedMobileWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
          <div className="max-w-md w-full bg-[#1a1a1a] rounded-3xl border border-white/10 shadow-2xl overflow-hidden">
            {/* Preview image at top */}
            <div className="relative w-full aspect-[16/9] overflow-hidden">
              <Image
                src="/upload.png"
                alt="TeslaNav Preview"
                fill
                className="object-cover"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a1a] via-transparent to-transparent" />
            </div>
            
            {/* Header text */}
            <div className="relative px-6 pt-4 pb-6 text-center -mt-8">
              <h2 className="text-xl font-semibold text-white mb-2">
                Best on Desktop or Tesla
              </h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                TeslaNav is designed for the Tesla in-car browser or desktop screens. The experience may be limited on mobile devices.
              </p>
            </div>

            {/* Content */}
            <div className="px-6 pb-6 space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5">
                <TeslaIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-white text-sm font-medium">Tesla Browser</p>
                  <p className="text-gray-400 text-xs">Open teslanav.com in your Tesla&apos;s browser for the best experience</p>
                </div>
              </div>
              
              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5">
                <DesktopIcon className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-white text-sm font-medium">Desktop Browser</p>
                  <p className="text-gray-400 text-xs">Full features available on Chrome, Safari, Firefox, or Edge</p>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={() => {
                    setDismissedMobileWarning(true);
                    localStorage.setItem("teslanav-mobile-dismissed", "true");
                    posthog.capture("mobile_warning_dismissed", { action: "continue_anyway" });
                  }}
                  className="w-full py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/20 transition-colors"
                >
                  Continue Anyway
                </button>
                <p className="text-center text-gray-500 text-xs">
                  Some features may not work as expected
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
    </svg>
  );
}

function CrosshairIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function CloseNavIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function NavigateToIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function LocationSearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}

function DesktopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
    </svg>
  );
}

function TeslaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 5.362l2.475-3.026s4.245.09 8.471 2.054c-1.082 1.636-3.231 2.438-3.231 2.438-.146-1.439-1.154-1.79-4.354-1.79L12 24 8.619 5.038c-3.18 0-4.188.351-4.335 1.79 0 0-2.148-.802-3.23-2.438C5.28 2.426 9.525 2.336 9.525 2.336L12 5.362z"/>
    </svg>
  );
}

