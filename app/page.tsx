"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Map, type MapRef } from "@/components/Map";
import { SettingsModal, type ThemeMode } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { ReportModal } from "@/components/ReportModal";
import { WelcomeBackFanfare } from "@/components/WelcomeBackFanfare";
import { WhatsNew } from "@/components/WhatsNew";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useSolarTheme } from "@/hooks/useSolarTheme";
import { useWazeAlerts } from "@/hooks/useWazeAlerts";
import { useSpeedCameras } from "@/hooks/useSpeedCameras";
import {
  isOpenFreeMapStyle,
  OPENFREEMAP_STYLES,
  type OpenFreeMapStyle,
} from "@/lib/map-styles";
import { trackAnalyticsEvent } from "@/lib/analytics-client";
import { detectUnitSystem, type UnitSystem } from "@/lib/units";
import type { MapBounds, WazeAlert } from "@/types/waze";
import Image from "next/image";
import { ShieldExclamationIcon, ExclamationTriangleIcon, NoSymbolIcon } from "@heroicons/react/24/solid";
import {
  CircleHelp as HelpIcon,
  Crosshair as CrosshairIcon,
  Map as MapIcon,
  Minus as MinusIcon,
  Plus as PlusIcon,
  Satellite as SatelliteIcon,
  Settings as SettingsIcon,
  TriangleAlert as ReportIcon,
} from "lucide-react";

// Consistent button styles for light/dark mode - more transparent with blur
const getButtonStyles = (darkMode: boolean) =>
  darkMode
    ? "bg-[#1a1a1a]/50 text-white border-white/10"
    : "bg-white/50 text-black border-black/10";

const getContainerStyles = (darkMode: boolean) =>
  darkMode
    ? "bg-[#1a1a1a]/50 text-white border-white/10"
    : "bg-white/50 text-black border-black/10";

type MapMode = "standard" | "satellite";
type DevMapStyle = OpenFreeMapStyle | "auto";

export default function Home() {
  const [mapMode, setMapMode] = useState<MapMode>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("teslanav-map-mode") === "satellite"
        ? "satellite"
        : "standard";
    }
    return "standard";
  });
  const [devMapStyle, setDevMapStyle] = useState<DevMapStyle>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("teslanav-map-style");
      if (isOpenFreeMapStyle(saved)) return saved;
      if (saved === "auto") return "auto";
    }
    return "auto";
  });
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [unitSystem] = useState<UnitSystem>(() =>
    typeof window !== "undefined" ? detectUnitSystem() : "imperial"
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("teslanav-theme-mode");
      if (saved === "light" || saved === "dark") return saved;
    }
    return "auto";
  });
  const [followMode, setFollowMode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("teslanav-follow-mode");
      return saved === "true";
    }
    return false;
  });
  const [isCentered, setIsCentered] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showWazeAlerts, setShowWazeAlerts] = useState(true);
  const [showSpeedCameras, setShowSpeedCameras] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("teslanav-speed-cameras") !== "false";
    }
    return true;
  });
  const [showAvatarPulse, setShowAvatarPulse] = useState(true);
  const [showSupportBanner, setShowSupportBanner] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("teslanav-support-banner");
      return saved !== null ? saved === "true" : true; // Default to showing the banner
    }
    return true;
  });
  const mapRef = useRef<MapRef>(null);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  const [dismissedMobileWarning, setDismissedMobileWarning] = useState(false);

  // Police alert settings - use lazy init to read from localStorage immediately
  const [policeAlertDistance, setPoliceAlertDistance] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("teslanav-police-distance");
      return saved !== null ? parseInt(saved, 10) : 805;
    }
    return 805; // meters (~0.5 miles), 0 = off
  });
  const [policeAlertSound, setPoliceAlertSound] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("teslanav-police-sound");
      return saved === "true";
    }
    return false; // off by default
  });
  const [policeAlertToast, setPoliceAlertToast] = useState<{ show: boolean; expanding: boolean } | null>(null);
  const alertedPoliceIdsRef = useRef<Set<string>>(new Set());
  // Camera proximity alerts mirror the police alert flow
  const [cameraAlertDistance, setCameraAlertDistance] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("teslanav-camera-distance");
      return saved !== null ? parseInt(saved, 10) : 805;
    }
    return 805; // meters (~0.5 miles), 0 = off
  });
  const [cameraAlertToast, setCameraAlertToast] = useState<{ label: string } | null>(null);
  const alertedCameraIdsRef = useRef<Set<string>>(new Set());
  const lastCameraAlertTimeRef = useRef<number>(0);
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastAlertTimeRef = useRef<number>(0);
  const ALERT_COOLDOWN_MS = 5000; // 5 seconds between alerts
  // Time-based warmup: suppress alerts for first N seconds after page load
  // This prevents alerts for cops that are already nearby when you open the app
  const pageLoadTimeRef = useRef<number | null>(null);
  const WARMUP_PERIOD_MS = 10000; // 10 seconds warmup - silently mark nearby cops as seen

  // Dev mode
  const [isDevMode, setIsDevMode] = useState(false);

  const { latitude, longitude, heading, effectiveHeading, speed, error: geoError } = useGeolocation();
  const solarTheme = useSolarTheme(latitude, longitude);
  const isDarkMode =
    themeMode === "auto" ? solarTheme.isDark : themeMode === "dark";

  const handleThemeModeChange = useCallback((value: ThemeMode) => {
    setThemeMode(value);
    localStorage.setItem("teslanav-theme-mode", value);
  }, []);
  const {
    alerts,
    loading: alertsLoading,
    cachedTileBounds,
    addLocalAlert,
    removeLocalAlert,
  } = useWazeAlerts({
    bounds,
    enabled: showWazeAlerts,
  });

  const { cameras } = useSpeedCameras({ bounds, enabled: showSpeedCameras });

  const handleToggleSpeedCameras = useCallback((value: boolean) => {
    setShowSpeedCameras(value);
    localStorage.setItem("teslanav-speed-cameras", String(value));
  }, []);

  // Show a just-submitted report on the map immediately, and never trigger
  // the police proximity toast for the reporter's own sighting.
  const handleReported = useCallback(
    (alert: WazeAlert) => {
      if (alert.type === "POLICE") alertedPoliceIdsRef.current.add(alert.id);
      addLocalAlert(alert);
    },
    [addLocalAlert]
  );

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

  // Check if an alert location is ahead of the user's direction of travel
  const isAlertAhead = useCallback((alertLat: number, alertLng: number, currentHeading: number | null): boolean => {
    // If we don't know the heading, treat everything as "ahead"
    if (currentHeading === null || currentHeading === undefined) return true;
    if (!latitude || !longitude) return true;

    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;

    const dLng = toRad(alertLng - longitude);
    const lat1Rad = toRad(latitude);
    const lat2Rad = toRad(alertLat);

    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x =
      Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    const bearingToAlert = (toDeg(Math.atan2(y, x)) + 360) % 360;

    // Angular difference between our heading and the bearing to the alert
    let diff = Math.abs(bearingToAlert - currentHeading) % 360;
    if (diff > 180) diff = 360 - diff;

    // Consider "ahead" anything within a 75° cone in front of us
    return diff <= 75;
  }, [latitude, longitude]);

  // Initialize audio element on mount
  // Note: Other settings are loaded via lazy useState initialization above
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Initialize audio element
      alertAudioRef.current = new Audio("/alert-sound.mp3");

      // Apply saved follow mode to map when it's ready
      const savedFollowMode = localStorage.getItem("teslanav-follow-mode");
      if (savedFollowMode === "true") {
        setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.setFollowMode(true);
          }
        }, 100);
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

  // Detect dev mode from URL parameter
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setIsDevMode(params.get("dev") === "true");
    }
  }, []);

  // Save police alert distance to localStorage
  const handlePoliceAlertDistanceChange = useCallback((value: number) => {
    setPoliceAlertDistance(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("teslanav-police-distance", value.toString());
    }
    // Clear alerted IDs when changing distance so alerts can re-trigger
    alertedPoliceIdsRef.current.clear();
  }, []);

  // Save camera alert distance to localStorage
  const handleCameraAlertDistanceChange = useCallback((value: number) => {
    setCameraAlertDistance(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("teslanav-camera-distance", value.toString());
    }
    // Clear alerted IDs when changing distance so alerts can re-trigger
    alertedCameraIdsRef.current.clear();
  }, []);

  // Save police alert sound preference to localStorage
  const handleTogglePoliceAlertSound = useCallback((value: boolean) => {
    setPoliceAlertSound(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("teslanav-police-sound", value.toString());
    }
  }, []);

  // Save support banner preference to localStorage
  const handleToggleSupportBanner = useCallback((value: boolean) => {
    setShowSupportBanner(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("teslanav-support-banner", value.toString());
    }
  }, []);

  // Police proximity alerts
  useEffect(() => {
    if (!latitude || !longitude || !showWazeAlerts) return;
    if (policeAlertDistance === 0) return;

    const now = Date.now();
    if (pageLoadTimeRef.current === null) pageLoadTimeRef.current = now;
    const policeAlerts = alerts.filter((alert) => alert.type === "POLICE");
    const isInWarmupPeriod = now - pageLoadTimeRef.current < WARMUP_PERIOD_MS;

    // During warmup, silently mark all nearby police as "seen" without triggering
    // This prevents alerts for cops that are already nearby when you open the app
    // or when your GPS position is still stabilizing
    if (isInWarmupPeriod) {
      for (const alert of policeAlerts) {
        const distance = getDistanceInMeters(
          latitude,
          longitude,
          alert.location.y,
          alert.location.x
        );

        if (distance <= policeAlertDistance) {
          // Silently mark as seen (no alert triggered)
          alertedPoliceIdsRef.current.add(alert.id);
        }
      }
      return; // Skip normal alert processing during warmup
    }

    // Check if we're still in cooldown period
    if (now - lastAlertTimeRef.current < ALERT_COOLDOWN_MS) {
      return; // Still in cooldown, don't trigger any new alerts
    }

    // Check each police alert for proximity
    for (const alert of policeAlerts) {
      // Skip if we already alerted for this one
      if (alertedPoliceIdsRef.current.has(alert.id)) continue;

      const distance = getDistanceInMeters(
        latitude,
        longitude,
        alert.location.y, // lat
        alert.location.x  // lng
      );

      if (distance <= policeAlertDistance) {
        // Only alert if the police is AHEAD of us, not behind
        if (!isAlertAhead(alert.location.y, alert.location.x, effectiveHeading)) {
          // Mark as "seen" so we don't keep checking it, but don't alert
          alertedPoliceIdsRef.current.add(alert.id);
          continue;
        }

        // Mark as alerted and set cooldown
        alertedPoliceIdsRef.current.add(alert.id);
        lastAlertTimeRef.current = now;

        // Show toast notification
        setPoliceAlertToast({ show: true, expanding: false });

        // Start expansion animation after a brief moment
        setTimeout(() => {
          setPoliceAlertToast({ show: true, expanding: true });
        }, 50);

        // Play sound if enabled
        if (policeAlertSound && alertAudioRef.current) {
          alertAudioRef.current.currentTime = 0;
          alertAudioRef.current.play().catch(err => {
            console.log("Audio play failed:", err);
          });
        }

        trackAnalyticsEvent(
          "police_alert_triggered",
          policeAlertSound ? "sound" : "silent"
        );

        // Auto-hide after 5 seconds
        setTimeout(() => {
          setPoliceAlertToast(null);
        }, 5000);

        // Only show one alert at a time
        break;
      }
    }
  }, [latitude, longitude, alerts, policeAlertDistance, policeAlertSound, showWazeAlerts, getDistanceInMeters, effectiveHeading, isAlertAhead]);

  // Fixed camera proximity alerts (speed / red-light), mirroring the police
  // flow: warmup marks nearby cameras as seen, then only newly approached
  // cameras ahead of the direction of travel trigger a warning.
  useEffect(() => {
    if (!latitude || !longitude || !showSpeedCameras) return;
    if (cameraAlertDistance === 0) return;

    const now = Date.now();
    if (pageLoadTimeRef.current === null) pageLoadTimeRef.current = now;
    const isInWarmupPeriod = now - pageLoadTimeRef.current < WARMUP_PERIOD_MS;

    if (isInWarmupPeriod) {
      for (const camera of cameras) {
        const distance = getDistanceInMeters(
          latitude,
          longitude,
          camera.location.lat,
          camera.location.lon
        );
        if (distance <= cameraAlertDistance) {
          alertedCameraIdsRef.current.add(camera.id);
        }
      }
      return;
    }

    if (now - lastCameraAlertTimeRef.current < ALERT_COOLDOWN_MS) return;

    for (const camera of cameras) {
      if (alertedCameraIdsRef.current.has(camera.id)) continue;

      const distance = getDistanceInMeters(
        latitude,
        longitude,
        camera.location.lat,
        camera.location.lon
      );
      if (distance > cameraAlertDistance) continue;

      if (!isAlertAhead(camera.location.lat, camera.location.lon, effectiveHeading)) {
        alertedCameraIdsRef.current.add(camera.id);
        continue;
      }

      alertedCameraIdsRef.current.add(camera.id);
      lastCameraAlertTimeRef.current = now;
      const label =
        camera.type === "red_light_camera"
          ? "RED LIGHT CAMERA AHEAD"
          : "SPEED CAMERA AHEAD";
      // Deferred so the effect body itself never sets state synchronously.
      setTimeout(() => {
        setCameraAlertToast({ label });
      }, 0);
      if (policeAlertSound && alertAudioRef.current) {
        alertAudioRef.current.currentTime = 0;
        alertAudioRef.current.play().catch((err) => {
          console.log("Audio play failed:", err);
        });
      }
      trackAnalyticsEvent("camera_alert_triggered", camera.type);
      setTimeout(() => {
        setCameraAlertToast(null);
      }, 5000);
      break;
    }
  }, [latitude, longitude, cameras, cameraAlertDistance, showSpeedCameras, policeAlertSound, getDistanceInMeters, effectiveHeading, isAlertAhead]);

  // Forward report votes and reflect the result on the map immediately.
  const handleReportVote = useCallback(
    async (
      reportId: string,
      vote: "confirm" | "gone"
    ): Promise<{ removed?: boolean } | null> => {
      try {
        const response = await fetch("/api/reports/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportId, vote }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        trackAnalyticsEvent("report_voted", vote);
        if (data.removed) {
          removeLocalAlert(`alert-user/${reportId}`);
        }
        return { removed: Boolean(data.removed) };
      } catch {
        return null;
      }
    },
    [removeLocalAlert]
  );

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

  const toggleMapMode = useCallback(() => {
    setMapMode((current) => {
      const next = current === "satellite" ? "standard" : "satellite";
      localStorage.setItem("teslanav-map-mode", next);
      trackAnalyticsEvent("map_mode_changed", next);
      return next;
    });
    // A direct user toggle exits any developer-only style override.
    setDevMapStyle("auto");
    localStorage.setItem("teslanav-map-style", "auto");
  }, []);

  const toggleFollowMode = useCallback(() => {
    setFollowMode((prev) => {
      const newValue = !prev;
      if (mapRef.current) {
        mapRef.current.setFollowMode(newValue);
      }

      // Save to localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem("teslanav-follow-mode", newValue.toString());
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

  // Show refocus button when not centered (regardless of rotation mode)
  const showRefocusButton = !isCentered && latitude && longitude;

  // Compass colors based on theme
  const compassCircleColor = isDarkMode ? "#6b7280" : "#9ca3af";
  const compassNeedleColor = followMode ? "#3b82f6" : (isDarkMode ? "#d1d5db" : "#374151");
  const compassCenterFill = isDarkMode ? "#1a1a1a" : "white";
  const compassCenterStroke = isDarkMode ? "#9ca3af" : "#374151";
  const automaticMapStyle: OpenFreeMapStyle =
    mapMode === "satellite" ? "satellite-esri" : isDarkMode ? "dark" : "liberty";
  const mapStyle = isDevMode && devMapStyle !== "auto"
    ? devMapStyle
    : automaticMapStyle;
  const mapStyleDefinition = OPENFREEMAP_STYLES[mapStyle];
  const effectiveStyleUrl =
    isDarkMode && mapStyleDefinition.satelliteTilesUrl
      ? OPENFREEMAP_STYLES.dark.url
      : mapStyleDefinition.url;

  // Show full-screen loading until we have location
  if (!latitude || !longitude) {
    return (
      <main className="relative w-full h-full bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          {/* TeslaNav Logo/Title */}
          <div className="flex items-center gap-3">
            <Image
              src="/maps-avatar.jpg"
              alt="TeslaNav"
              width={48}
              height={48}
              className="rounded-lg"
            />
            <div className="flex flex-col">
              <span className="text-2xl font-bold text-white tracking-wide">TeslaNav</span>
              <span className="text-xs text-gray-500">v1.0.0</span>
            </div>
          </div>

          {/* Loading indicator */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 border-4 border-white/10 border-t-blue-500 rounded-full animate-spin" />
              <div className="absolute inset-0 w-12 h-12 border-4 border-transparent border-t-blue-400/30 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            </div>
            <span className="text-gray-400 text-sm font-medium">
              {geoError ? geoError : "Finding your location..."}
            </span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative w-full h-full">
      {/* Map */}
      <Map
        key={`${mapStyle}-${isDarkMode ? "night" : "day"}`}
        ref={mapRef}
        center={[longitude, latitude]}
        zoom={15}
        isDarkMode={isDarkMode}
        styleUrl={effectiveStyleUrl}
        satelliteTilesUrl={mapStyleDefinition.satelliteTilesUrl}
        satelliteAttribution={mapStyleDefinition.satelliteAttribution}
        satelliteMaxZoom={mapStyleDefinition.maxZoom}
        alerts={filteredAlerts}
        speedCameras={showSpeedCameras ? cameras : []}
        unitSystem={unitSystem}
        onReportVote={handleReportVote}
        onBoundsChange={handleBoundsChange}
        onCenteredChange={handleCenteredChange}
        userLocation={{ latitude, longitude, heading, effectiveHeading, speed }}
        followMode={followMode}
        showAvatarPulse={showAvatarPulse}
        showAlertRadius={isDevMode && policeAlertDistance > 0}
        alertRadiusMeters={policeAlertDistance}
        debugTileBounds={isDevMode ? cachedTileBounds : undefined}
      />

      {/* Dev-only OpenFreeMap style selector */}
      {isDevMode && (
        <label
          className={`
            absolute top-4 left-1/2 z-40 -translate-x-1/2
            flex h-12 items-center gap-3 rounded-xl px-4 backdrop-blur-xl
            ${getContainerStyles(isDarkMode)} shadow-lg border
          `}
        >
          <span className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${isDarkMode ? "text-white/55" : "text-black/50"}`}>
            Map style
          </span>
          <select
            value={devMapStyle}
            onChange={(event) => {
              if (event.target.value === "auto") {
                setDevMapStyle("auto");
                localStorage.setItem("teslanav-map-style", "auto");
                trackAnalyticsEvent("map_style_changed", "auto");
                return;
              }
              if (!isOpenFreeMapStyle(event.target.value)) return;
              setDevMapStyle(event.target.value);
              setIsCentered(true);
              localStorage.setItem("teslanav-map-style", event.target.value);
              trackAnalyticsEvent("map_style_changed", event.target.value);
            }}
            aria-label="OpenFreeMap style"
            className={`
              h-9 min-w-36 cursor-pointer rounded-lg px-3 text-sm font-medium
              outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500
              ${isDarkMode ? "bg-white/10 text-white" : "bg-black/5 text-black"}
            `}
          >
            <option value="auto" className="text-black">
              {`Auto · ${isDarkMode ? "Night" : "Day"}`}
            </option>
            {Object.entries(OPENFREEMAP_STYLES).map(([id, style]) => (
              <option key={id} value={id} className="text-black">
                {style.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Top Left - Support Banner */}
      {showSupportBanner && (
        <div className="absolute top-4 left-4 z-30">
          <button
            onClick={() => {
              setShowSettings(true);
              trackAnalyticsEvent("sponsor_clicked", "banner");
            }}
            className={`
              flex items-center gap-2 px-4 py-2.5 rounded-xl backdrop-blur-xl
              ${getButtonStyles(isDarkMode)}
              shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
              group
            `}
          >
            <span className="text-lg">❤️</span>
            <span className="text-sm font-medium">Support this project</span>
            <svg
              className={`w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Top Right - Compass + Alert Summary (stacked) */}
      <div className="absolute top-4 right-4 z-30 flex flex-col items-end gap-3">
        {/* Compass/Orientation Toggle */}
        <button
          onClick={toggleFollowMode}
          className={`
            w-[72px] h-[72px] rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(isDarkMode)}
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
        {(filteredAlerts.length > 0 || alertsLoading) && (
          <div
            className={`
              w-[72px] flex flex-col items-center gap-1.5 py-3 rounded-xl backdrop-blur-xl
              ${getContainerStyles(isDarkMode)}
              shadow-lg border relative
            `}
          >
            {/* Waze loading indicator - shows when fetching new data */}
            {alertsLoading && (
              <div className="absolute -top-2 -right-2 z-10">
                <div className="relative">
                  <WazeIcon className="w-6 h-6 text-cyan-400 animate-pulse" />
                  <div className="absolute inset-0 w-6 h-6 rounded-full bg-cyan-400/30 animate-ping" />
                </div>
              </div>
            )}
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
            {/* Show placeholder when loading with no alerts yet */}
            {alertsLoading && filteredAlerts.length === 0 && (
              <span className={`text-xs ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Loading...
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom Left - User Location + Settings */}
      <div className="absolute bottom-6 left-4 z-30 flex items-center gap-3">
        {latitude && longitude && (
          <div
            className={`
              flex items-center gap-3 px-4 h-16 rounded-xl backdrop-blur-xl
              ${getContainerStyles(isDarkMode)}
              shadow-lg border
            `}
          >
            <Image
              src={isDarkMode ? "/maps-avatar.jpg" : "/maps-avatar-light.jpg"}
              alt="Your location"
              width={36}
              height={36}
            />
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-wide">
                TeslaNav
              </span>
              <span className={`text-[10px] ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                v1.0.0
              </span>
            </div>
          </div>
        )}

        {/* Settings Button */}
        <button
          onClick={() => {
            setShowSettings(true);
            trackAnalyticsEvent("settings_opened");
          }}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(isDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Settings"
        >
          <SettingsIcon className="w-7 h-7" />
        </button>

        {/* Feedback Button */}
        <button
          onClick={() => {
            setShowFeedback(true);
            trackAnalyticsEvent("feedback_opened");
          }}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${getButtonStyles(isDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Send feedback"
        >
          <HelpIcon className="w-7 h-7" />
        </button>
      </div>

      {/* Bottom Right - Control Buttons */}
      <div className="absolute bottom-6 right-4 z-30 flex gap-3">
        {/* Report Button */}
        <button
          onClick={() => {
            setShowReport(true);
            trackAnalyticsEvent("report_opened");
          }}
          className="px-5 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center gap-2 bg-amber-500/80 text-white border-amber-400/30 shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95"
          aria-label="Report police or a hazard"
        >
          <ReportIcon className="w-6 h-6" />
          <span className="text-lg font-medium">Report</span>
        </button>

        {/* Dev Mode - Police Alert Test Button */}
        {isDevMode && (
          <button
            onClick={() => {
              setPoliceAlertToast({ show: true, expanding: true });
              // Play sound if enabled
              if (policeAlertSound && alertAudioRef.current) {
                alertAudioRef.current.currentTime = 0;
                alertAudioRef.current.play().catch(err => console.log("Audio play failed:", err));
              }
              // Auto-hide after 5 seconds
              setTimeout(() => setPoliceAlertToast(null), 5000);
            }}
            className="px-4 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center gap-2 bg-blue-500/80 text-white border-blue-400/30 shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95"
            aria-label="Test police alert"
          >
            <PoliceAlertIcon className="w-5 h-5" />
            <span className="text-sm font-bold">Test Alert</span>
          </button>
        )}

        {/* Dev Mode Badge */}
        {isDevMode && (
          <div className="px-4 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center bg-purple-500/80 text-white border-purple-400/30 shadow-lg border">
            <span className="text-sm font-bold uppercase tracking-wider">Dev Mode</span>
          </div>
        )}

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
            ${getButtonStyles(isDarkMode)}
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
            ${getButtonStyles(isDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label="Zoom in"
        >
          <PlusIcon className="w-7 h-7" />
        </button>

        {/* Standard / Satellite Toggle */}
        <button
          onClick={toggleMapMode}
          className={`
            w-16 h-16 rounded-xl backdrop-blur-xl flex items-center justify-center
            ${mapMode === "satellite"
              ? "bg-blue-500/80 text-white border-blue-400/30"
              : getButtonStyles(isDarkMode)}
            shadow-lg border transition-all duration-200 hover:scale-105 active:scale-95
          `}
          aria-label={mapMode === "satellite" ? "Use standard map" : "Use satellite map"}
          aria-pressed={mapMode === "satellite"}
        >
          {mapMode === "satellite" ? (
            <MapIcon className="w-7 h-7" />
          ) : (
            <SatelliteIcon className="w-7 h-7" />
          )}
        </button>
      </div>

      {/* Police Alert - Full Screen Border Glow Effect */}
      {policeAlertToast?.show && (
        <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden police-alert-container">
          {/* Blue glow layer */}
          <div
            className="absolute inset-0 police-glow-blue"
            style={{
              background: `
                linear-gradient(to bottom, rgba(59, 130, 246, 0.7), transparent 30%),
                linear-gradient(to top, rgba(59, 130, 246, 0.7), transparent 30%),
                linear-gradient(to right, rgba(59, 130, 246, 0.7), transparent 20%),
                linear-gradient(to left, rgba(59, 130, 246, 0.7), transparent 20%)
              `,
            }}
          />

          {/* Red glow layer */}
          <div
            className="absolute inset-0 police-glow-red"
            style={{
              background: `
                linear-gradient(to bottom, rgba(239, 68, 68, 0.7), transparent 30%),
                linear-gradient(to top, rgba(239, 68, 68, 0.7), transparent 30%),
                linear-gradient(to right, rgba(239, 68, 68, 0.7), transparent 20%),
                linear-gradient(to left, rgba(239, 68, 68, 0.7), transparent 20%)
              `,
            }}
          />

          {/* Pull-down notification at top */}
          <div className="absolute top-0 left-0 right-0 flex justify-center police-pulldown">
            <div className="bg-black/90 backdrop-blur-md text-white px-12 py-6 rounded-b-3xl shadow-2xl border-b border-l border-r border-white/20">
              <div className="flex items-center gap-4">
                <PoliceAlertIcon className="w-12 h-12 police-icon" />
                <span className="text-4xl font-bold tracking-wide">POLICE AHEAD</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Camera Alert - amber pulldown notification */}
      {cameraAlertToast && !policeAlertToast?.show && (
        <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden police-alert-container">
          {/* Amber edge glow */}
          <div
            className="absolute inset-0"
            style={{
              background: `
                linear-gradient(to bottom, rgba(245, 158, 11, 0.55), transparent 25%),
                linear-gradient(to top, rgba(245, 158, 11, 0.55), transparent 25%),
                linear-gradient(to right, rgba(245, 158, 11, 0.55), transparent 15%),
                linear-gradient(to left, rgba(245, 158, 11, 0.55), transparent 15%)
              `,
            }}
          />
          <div className="absolute top-0 left-0 right-0 flex justify-center police-pulldown">
            <div className="bg-black/90 backdrop-blur-md text-white px-12 py-6 rounded-b-3xl shadow-2xl border-b border-l border-r border-amber-400/40">
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/speed-camera.svg" alt="" className="w-12 h-12" />
                <span className="text-4xl font-bold tracking-wide">
                  {cameraAlertToast.label}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        isDarkMode={isDarkMode}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        unitSystem={unitSystem}
        showWazeAlerts={showWazeAlerts}
        onToggleWazeAlerts={setShowWazeAlerts}
        showSpeedCameras={showSpeedCameras}
        onToggleSpeedCameras={handleToggleSpeedCameras}
        showAvatarPulse={showAvatarPulse}
        onToggleAvatarPulse={setShowAvatarPulse}
        showSupportBanner={showSupportBanner}
        onToggleSupportBanner={handleToggleSupportBanner}
        policeAlertDistance={policeAlertDistance}
        onPoliceAlertDistanceChange={handlePoliceAlertDistanceChange}
        policeAlertSound={policeAlertSound}
        onTogglePoliceAlertSound={handleTogglePoliceAlertSound}
        cameraAlertDistance={cameraAlertDistance}
        onCameraAlertDistanceChange={handleCameraAlertDistanceChange}
      />

      {/* Feedback Modal */}
      <FeedbackModal
        isOpen={showFeedback}
        onClose={() => setShowFeedback(false)}
        isDarkMode={isDarkMode}
      />

      {/* Report Modal */}
      <ReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        isDarkMode={isDarkMode}
        latitude={latitude}
        longitude={longitude}
        onReported={handleReported}
      />

      <WelcomeBackFanfare />

      <WhatsNew isDarkMode={isDarkMode} />

      {/* Global styles for police alert animations */}
      <style jsx global>{`
        .police-alert-container {
          animation: container-fade 3s ease-out forwards;
        }

        @keyframes container-fade {
          0%, 85% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }

        .police-glow-blue {
          animation: flash-blue 0.5s ease-in-out infinite;
        }

        .police-glow-red {
          animation: flash-red 0.5s ease-in-out infinite;
        }

        @keyframes flash-blue {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0;
          }
        }

        @keyframes flash-red {
          0%, 100% {
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
        }

        .police-pulldown {
          animation: pulldown-appear 0.4s ease-out, pulldown-glow 0.5s ease-in-out infinite;
        }

        @keyframes pulldown-appear {
          from {
            opacity: 0;
            transform: translateY(-100%);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes pulldown-glow {
          0%, 100% {
            filter: drop-shadow(0 0 30px rgba(59, 130, 246, 0.8));
          }
          50% {
            filter: drop-shadow(0 0 30px rgba(239, 68, 68, 0.8));
          }
        }

        .police-icon {
          animation: icon-color 0.5s ease-in-out infinite;
        }

        @keyframes icon-color {
          0%, 100% {
            color: rgb(96, 165, 250);
          }
          50% {
            color: rgb(248, 113, 113);
          }
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
                  <p className="text-gray-400 text-xs">Open the app in your Tesla&apos;s browser for the best experience</p>
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

function PoliceAlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
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

function WazeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 3 1 4.31V20l3.13-1.57c1.57.72 3.33 1.07 5.15.95 4.84-.31 8.72-4.19 9.03-9.03.34-5.31-3.87-9.65-9.18-9.35h-.13zm-2 13c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm4 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm2-5H8c0-2.21 1.79-4 4-4s4 1.79 4 4z"/>
    </svg>
  );
}
