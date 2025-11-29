"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Map, type MapRef } from "@/components/Map";
import { SettingsModal } from "@/components/SettingsModal";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useWazeAlerts } from "@/hooks/useWazeAlerts";
import { useReverseGeocode } from "@/hooks/useReverseGeocode";
import type { MapBounds } from "@/types/waze";
import Image from "next/image";

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
  const [showTraffic, setShowTraffic] = useState(false);
  const [useSatellite, setUseSatellite] = useState(false);
  const [showAvatarPulse, setShowAvatarPulse] = useState(true);
  const mapRef = useRef<MapRef>(null);

  const { latitude, longitude, heading, effectiveHeading, loading: geoLoading, error: geoError } = useGeolocation();
  const { alerts, loading: alertsLoading } = useWazeAlerts({ bounds });
  const { placeName, loading: placeLoading } = useReverseGeocode(latitude, longitude);

  // Load settings from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedSatellite = localStorage.getItem("teslanav-satellite");
      if (savedSatellite !== null) {
        setUseSatellite(savedSatellite === "true");
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
    }
  }, [latitude, longitude]);

  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((prev) => !prev);
  }, []);

  const toggleFollowMode = useCallback(() => {
    setFollowMode((prev) => {
      const newValue = !prev;
      if (mapRef.current) {
        mapRef.current.setFollowMode(newValue);
      }
      return newValue;
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut();
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

  // Show refocus button when not centered and not in follow mode
  const showRefocusButton = !isCentered && !followMode && latitude && longitude;

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
        onBoundsChange={handleBoundsChange}
        onCenteredChange={handleCenteredChange}
        userLocation={latitude && longitude ? { latitude, longitude, heading, effectiveHeading } : null}
        followMode={followMode}
        showTraffic={showTraffic}
        useSatellite={useSatellite}
        showAvatarPulse={showAvatarPulse}
      />

      {/* Top Right - Compass + Alert Summary (stacked) */}
      <div className="absolute top-4 right-4 z-30 flex flex-col items-end gap-2">
        {/* Compass/Orientation Toggle */}
        <button
          onClick={toggleFollowMode}
          className={`
            w-14 h-14 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label={followMode ? "Lock north up" : "Follow heading"}
        >
          <div className="relative w-8 h-8">
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
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white" />
            )}
          </div>
        </button>

        {/* Alert Summary - Stacked vertically, same width as compass */}
        {filteredAlerts.length > 0 && (
          <div
            className={`
              w-14 flex flex-col items-center gap-1 py-2 rounded-xl backdrop-blur-xl
              ${getContainerStyles(effectiveDarkMode)}
              shadow-lg border
            `}
          >
            {alertCounts.police > 0 && (
              <span className="flex items-center gap-1 text-sm">
                <span className="text-lg">🚔</span>
                <span className="font-medium">{alertCounts.police}</span>
              </span>
            )}
            {alertCounts.accidents > 0 && (
              <span className="flex items-center gap-1 text-sm">
                <span className="text-lg">🚨</span>
                <span className="font-medium">{alertCounts.accidents}</span>
              </span>
            )}
            {alertCounts.hazards > 0 && (
              <span className="flex items-center gap-1 text-sm">
                <span className="text-lg">⚠️</span>
                <span className="font-medium">{alertCounts.hazards}</span>
              </span>
            )}
            {alertCounts.closures > 0 && (
              <span className="flex items-center gap-1 text-sm">
                <span className="text-lg">🚧</span>
                <span className="font-medium">{alertCounts.closures}</span>
              </span>
            )}
            {alertsLoading && (
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            )}
          </div>
        )}
      </div>

      {/* Bottom Left - User Location + Settings */}
      <div className="absolute bottom-6 left-4 z-30 flex items-center gap-2">
        {latitude && longitude && (
          <div
            className={`
              flex items-center gap-3 px-3 py-2 rounded-xl backdrop-blur-xl
              ${getContainerStyles(effectiveDarkMode)}
              shadow-lg border
            `}
          >
            <Image
              src={effectiveDarkMode ? "/maps-avatar.jpg" : "/maps-avatar-light.jpg"}
              alt="Your location"
              width={28}
              height={28}
            />
            <div className="flex flex-col">
              <span className={`text-[10px] uppercase tracking-wider ${effectiveDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Your Location
              </span>
              <span className="text-xs font-medium">
                {placeLoading ? "..." : (placeName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)}
              </span>
            </div>
          </div>
        )}

        {/* Settings Button */}
        <button
          onClick={() => setShowSettings(true)}
          className={`
            w-11 h-11 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Settings"
        >
          <SettingsIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Bottom Right - Control Buttons */}
      <div className="absolute bottom-6 right-4 z-30 flex gap-2">
        {/* Refocus Button - Only shows when not centered */}
        {showRefocusButton && (
          <button
            onClick={handleRecenter}
            className={`
              px-4 h-11 rounded-xl backdrop-blur-xl flex items-center justify-center gap-2
              bg-blue-500/80 text-white border-blue-400/30
              shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
            `}
            aria-label="Recenter on location"
          >
            <CrosshairIcon className="w-4 h-4" />
            <span className="text-sm font-medium">Recenter</span>
          </button>
        )}

        {/* Zoom Out */}
        <button
          onClick={handleZoomOut}
          className={`
            w-11 h-11 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Zoom out"
        >
          <MinusIcon className="w-5 h-5" />
        </button>

        {/* Zoom In */}
        <button
          onClick={handleZoomIn}
          className={`
            w-11 h-11 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Zoom in"
        >
          <PlusIcon className="w-5 h-5" />
        </button>

        {/* Dark Mode Toggle */}
        <button
          onClick={toggleDarkMode}
          className={`
            w-11 h-11 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(effectiveDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Toggle dark mode"
        >
          {isDarkMode ? (
            <SunIcon className="w-5 h-5" />
          ) : (
            <MoonIcon className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Loading Overlay - pointer-events-none allows buttons to remain clickable */}
      {geoLoading && !latitude && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            className={`
              relative px-6 py-4 rounded-2xl backdrop-blur-md
              ${effectiveDarkMode ? "bg-[#1a1a1a]/90 text-white border-white/10" : "bg-white/95 text-black border-black/5"}
              shadow-2xl border
            `}
          >
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium">Finding your location...</span>
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {geoError && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20">
          <div className="px-4 py-2 rounded-xl bg-red-500/95 text-white text-sm font-medium shadow-lg">
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
        showTraffic={showTraffic}
        onToggleTraffic={setShowTraffic}
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
