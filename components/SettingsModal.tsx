"use client";

import { useState, useEffect } from "react";
import { ShieldExclamationIcon } from "@heroicons/react/24/solid";
import { trackAnalyticsEvent } from "@/lib/analytics-client";
import { SuggestionBox } from "@/components/SuggestionBox";
import type { UnitSystem } from "@/lib/units";

export type ThemeMode = "auto" | "light" | "dark";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  themeMode: ThemeMode;
  onThemeModeChange: (value: ThemeMode) => void;
  unitSystem: UnitSystem;
  showWazeAlerts: boolean;
  onToggleWazeAlerts: (value: boolean) => void;
  showSpeedCameras: boolean;
  onToggleSpeedCameras: (value: boolean) => void;
  showAvatarPulse: boolean;
  onToggleAvatarPulse: (value: boolean) => void;
  showSupportBanner: boolean;
  onToggleSupportBanner: (value: boolean) => void;
  // Police alert settings
  policeAlertDistance: number;
  onPoliceAlertDistanceChange: (value: number) => void;
  policeAlertSound: boolean;
  onTogglePoliceAlertSound: (value: boolean) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  isDarkMode,
  themeMode,
  onThemeModeChange,
  unitSystem,
  showWazeAlerts,
  onToggleWazeAlerts,
  showSpeedCameras,
  onToggleSpeedCameras,
  showAvatarPulse,
  onToggleAvatarPulse,
  showSupportBanner,
  onToggleSupportBanner,
  policeAlertDistance,
  onPoliceAlertDistanceChange,
  policeAlertSound,
  onTogglePoliceAlertSound,
}: SettingsModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // Small delay to trigger animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    } else {
      setIsVisible(false);
      // Wait for animation to complete before unmounting
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <div
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        transition-opacity duration-300 ease-out
        ${isVisible ? "opacity-100" : "opacity-0"}
      `}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className={`
          absolute inset-0 bg-black/50 backdrop-blur-sm
          transition-opacity duration-300 ease-out
          ${isVisible ? "opacity-100" : "opacity-0"}
        `}
      />

      {/* Modal */}
      <div
        className={`
          relative w-[80%] h-[80%] rounded-2xl overflow-hidden
          ${isDarkMode ? "bg-[#1a1a1a] text-white" : "bg-white text-black"}
          shadow-2xl flex flex-col
          transition-all duration-300 ease-out
          ${isVisible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4"}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`
          flex items-center justify-between px-6 py-5 border-b
          ${isDarkMode ? "border-white/10" : "border-black/10"}
        `}>
          <h2 className="text-2xl font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className={`
              w-12 h-12 rounded-xl flex items-center justify-center
              ${isDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"}
              transition-colors
            `}
            aria-label="Close settings"
          >
            <CloseIcon className="w-7 h-7" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-lg mx-auto space-y-8">
            {/* Sponsor Section */}
            <div
              className={`
                p-5 rounded-xl border-2 border-dashed
                ${isDarkMode
                  ? "border-pink-500/50 bg-pink-500/10"
                  : "border-pink-400/50 bg-pink-50"
                }
              `}
            >
              <div className="flex flex-col items-center text-center gap-4">
                <span className="text-3xl">❤️</span>
                <div>
                  <div className="text-lg font-semibold">Help Sponsor This Project</div>
                  <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                    TeslaNav will always be free and ad-free. Your support helps keep it that way!
                  </div>
                </div>
                {/* QR Code */}
                <div
                  className="bg-white p-3 rounded-xl cursor-pointer hover:scale-105 transition-transform"
                  onClick={() => {
                    trackAnalyticsEvent("sponsor_clicked", "settings");
                    window.open("https://buy.stripe.com/9B68wPg5wavU3Px3Tb7EQ0c", "_blank");
                  }}
                >
                  <img
                    src="/teslanav-donation-qrcode.png"
                    alt="Scan to donate"
                    className="w-40 h-40"
                  />
                </div>
                <div className={`text-sm ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
                  Scan QR code or tap to donate
                </div>
              </div>
            </div>

            {/* Map Layers Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Map Layers
              </h3>

              <div className="space-y-4">
                {/* Waze Alerts Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <ShieldExclamationIcon className="w-8 h-8 text-blue-500" />
                    <div>
                      <div className="text-lg font-medium">Waze Alerts</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Police, accidents, hazards, road closures
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={showWazeAlerts}
                    onToggle={onToggleWazeAlerts}
                    isDarkMode={isDarkMode}
                  />
                </div>

                {/* Speed Cameras Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/icons/speed-camera.svg" alt="" className="w-8 h-8" />
                    <div>
                      <div className="text-lg font-medium">Speed Cameras</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Fixed speed &amp; red-light camera locations
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={showSpeedCameras}
                    onToggle={(value) => {
                      onToggleSpeedCameras(value);
                      trackAnalyticsEvent("speed_cameras_toggled", value ? "on" : "off");
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>
              </div>
            </div>

            {/* Police Alerts Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Police Alerts
              </h3>

              <div className="space-y-4">
                {/* Alert Distance Selector */}
                <div className={`
                  p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4 mb-4">
                    <ShieldExclamationIcon className="w-8 h-8 text-blue-500" />
                    <div>
                      <div className="text-lg font-medium">Alert Distance</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Get notified when police are within this distance
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { value: 0, imperial: "Off", metric: "Off" },
                      { value: 402, imperial: "¼ mi", metric: "400 m" },
                      { value: 805, imperial: "½ mi", metric: "800 m" },
                      { value: 1609, imperial: "1 mi", metric: "1.6 km" },
                      { value: 3219, imperial: "2 mi", metric: "3.2 km" },
                    ].map(({ value, ...labels }) => ({ value, label: labels[unitSystem] })).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => onPoliceAlertDistanceChange(option.value)}
                        className={`
                          px-4 py-2.5 rounded-xl text-base font-medium transition-all
                          ${policeAlertDistance === option.value
                            ? "bg-blue-500 text-white"
                            : isDarkMode
                              ? "bg-white/10 hover:bg-white/20 text-white"
                              : "bg-black/10 hover:bg-black/20 text-black"
                          }
                        `}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sound Alert Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                  ${policeAlertDistance === 0 ? "opacity-50 pointer-events-none" : ""}
                `}>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">🔊</span>
                    <div>
                      <div className="text-lg font-medium">Sound Alert</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Play audio when police are nearby
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={policeAlertSound}
                    onToggle={onTogglePoliceAlertSound}
                    isDarkMode={isDarkMode}
                  />
                </div>
              </div>
            </div>

            {/* Appearance Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Appearance
              </h3>

              <div className="space-y-4">
                {/* Theme Mode Selector */}
                <div className={`
                  p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4 mb-4">
                    <span className="text-3xl">🌗</span>
                    <div>
                      <div className="text-lg font-medium">Theme</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Auto switches with sunrise and sunset at your location
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { value: "auto", label: "Auto" },
                      { value: "light", label: "Light" },
                      { value: "dark", label: "Dark" },
                    ] as const).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          onThemeModeChange(option.value);
                          trackAnalyticsEvent("theme_mode_changed", option.value);
                        }}
                        className={`
                          px-5 py-2.5 rounded-xl text-base font-medium transition-all
                          ${themeMode === option.value
                            ? "bg-blue-500 text-white"
                            : isDarkMode
                              ? "bg-white/10 hover:bg-white/20 text-white"
                              : "bg-black/10 hover:bg-black/20 text-black"
                          }
                        `}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Avatar Pulse Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">💫</span>
                    <div>
                      <div className="text-lg font-medium">Location Pulse</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Animated pulse around your avatar
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={showAvatarPulse}
                    onToggle={onToggleAvatarPulse}
                    isDarkMode={isDarkMode}
                  />
                </div>

                {/* Support Banner Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">❤️</span>
                    <div>
                      <div className="text-lg font-medium">Support Banner</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Show &quot;Support this project&quot; in top left
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={showSupportBanner}
                    onToggle={onToggleSupportBanner}
                    isDarkMode={isDarkMode}
                  />
                </div>
              </div>
            </div>

            {/* Suggestions */}
            <SuggestionBox isDarkMode={isDarkMode} />

            {/* About Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                About
              </h3>
              <div className={`
                p-5 rounded-xl
                ${isDarkMode ? "bg-white/5" : "bg-black/5"}
              `}>
                <div className="text-lg font-medium">TeslaNav</div>
                <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Navigation with Waze alerts for Tesla
                </div>
                <div className={`text-base mt-2 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Made by{" "}
                  <a
                    href="https://x.com/ryanvogel"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    Ryan Vogel
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Toggle Switch Component
function Toggle({
  enabled,
  onToggle,
  isDarkMode
}: {
  enabled: boolean;
  onToggle: (value: boolean) => void;
  isDarkMode: boolean;
}) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      className={`
        relative w-16 h-9 rounded-full transition-colors duration-200 flex-shrink-0
        ${enabled
          ? "bg-blue-500"
          : isDarkMode ? "bg-white/20" : "bg-black/20"
        }
      `}
      aria-label={enabled ? "Disable" : "Enable"}
    >
      <div
        className={`
          absolute top-1 w-7 h-7 rounded-full bg-white shadow-md
          transition-transform duration-200
          ${enabled ? "translate-x-8" : "translate-x-1"}
        `}
      />
    </button>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
