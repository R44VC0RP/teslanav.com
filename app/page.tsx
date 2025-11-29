"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Map, type MapRef } from "@/components/Map";
import { SettingsModal } from "@/components/SettingsModal";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useWazeAlerts } from "@/hooks/useWazeAlerts";
import { useSpeedCameras } from "@/hooks/useSpeedCameras";
import { useReverseGeocode } from "@/hooks/useReverseGeocode";
import type { MapBounds } from "@/types/waze";
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

  const { latitude, longitude, heading, effectiveHeading, loading: geoLoading, error: geoError } = useGeolocation();
  const { alerts, loading: alertsLoading } = useWazeAlerts({ bounds });
  const { cameras } = useSpeedCameras({ bounds, enabled: showSpeedCameras });
  const { placeName, loading: placeLoading } = useReverseGeocode(latitude, longitude);

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
        userLocation={latitude && longitude ? { latitude, longitude, heading, effectiveHeading } : null}
        followMode={followMode}
        showTraffic={showTraffic}
        useSatellite={useSatellite}
        showAvatarPulse={showAvatarPulse}
      />

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

