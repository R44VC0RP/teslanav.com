"use client";

import { useState, useEffect } from "react";
import posthog from "posthog-js";
import { ShieldExclamationIcon, MapIcon } from "@heroicons/react/24/solid";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  showWazeAlerts: boolean;
  onToggleWazeAlerts: (value: boolean) => void;
  showSpeedCameras: boolean;
  onToggleSpeedCameras: (value: boolean) => void;
  showTraffic: boolean;
  onToggleTraffic: (value: boolean) => void;
  useSatellite: boolean;
  onToggleSatellite: (value: boolean) => void;
  showAvatarPulse: boolean;
  onToggleAvatarPulse: (value: boolean) => void;
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
  showWazeAlerts,
  onToggleWazeAlerts,
  showSpeedCameras,
  onToggleSpeedCameras,
  showTraffic,
  onToggleTraffic,
  useSatellite,
  onToggleSatellite,
  showAvatarPulse,
  onToggleAvatarPulse,
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
            onClick={() => {
              onClose();
              // Track settings closed event
              posthog.capture("settings_closed");
            }}
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
            {/* Map Style Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Map Style
              </h3>
              
              <div className="space-y-4">
                {/* Satellite Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">🛰️</span>
                    <div>
                      <div className="text-lg font-medium">Satellite View</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Use satellite imagery instead of standard map
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={useSatellite}
                    onToggle={(value) => {
                      onToggleSatellite(value);
                      // Track satellite view toggle
                      posthog.capture("satellite_view_toggled", {
                        satellite_enabled: value,
                      });
                    }}
                    isDarkMode={isDarkMode}
                  />
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
                    onToggle={(value) => {
                      onToggleWazeAlerts(value);
                      // Track Waze alerts toggle
                      posthog.capture("waze_alerts_toggled", {
                        alerts_enabled: value,
                      });
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>

                {/* Speed Cameras Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">📷</span>
                    <div>
                      <div className="text-lg font-medium">Speed Cameras</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Speed & red light cameras from OpenStreetMap
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={showSpeedCameras}
                    onToggle={(value) => {
                      onToggleSpeedCameras(value);
                      // Track speed cameras toggle
                      posthog.capture("speed_cameras_toggled", {
                        cameras_enabled: value,
                      });
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>

                {/* Traffic Toggle */}
                <div className={`
                  flex items-center justify-between p-5 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-4">
                    <MapIcon className="w-8 h-8 text-orange-500" />
                    <div>
                      <div className="text-lg font-medium">Traffic Layer</div>
                      <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Show real-time traffic congestion
                      </div>
                    </div>
                  </div>
                  <Toggle
                    enabled={showTraffic}
                    onToggle={(value) => {
                      onToggleTraffic(value);
                      // Track traffic layer toggle
                      posthog.capture("traffic_layer_toggled", {
                        traffic_enabled: value,
                      });
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
                      { value: 0, label: "Off" },
                      { value: 500, label: "500m" },
                      { value: 1000, label: "1 km" },
                      { value: 1500, label: "1.5 km" },
                      { value: 2000, label: "2 km" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          onPoliceAlertDistanceChange(option.value);
                          posthog.capture("police_alert_distance_changed", {
                            distance_meters: option.value,
                          });
                        }}
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
                    onToggle={(value) => {
                      onTogglePoliceAlertSound(value);
                      posthog.capture("police_alert_sound_toggled", {
                        sound_enabled: value,
                      });
                    }}
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
                    onToggle={(value) => {
                      onToggleAvatarPulse(value);
                      // Track avatar pulse toggle
                      posthog.capture("avatar_pulse_toggled", {
                        pulse_enabled: value,
                      });
                    }}
                    isDarkMode={isDarkMode}
                  />
                </div>
              </div>
            </div>

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

            {/* Support Section */}
            <div>
              <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Support
              </h3>
              <div className={`
                p-5 rounded-xl
                ${isDarkMode ? "bg-white/5" : "bg-black/5"}
              `}>
                <div className="flex items-center gap-4">
                  <span className="text-3xl">💬</span>
                  <div>
                    <div className="text-lg font-medium">Feature Requests & Bug Reports</div>
                    <div className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                      Have an idea or found a bug? Let us know!
                    </div>
                    <a 
                      href="mailto:ryan@teslanav.com"
                      className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-lg bg-blue-500 text-white text-base font-medium hover:bg-blue-600 transition-colors"
                      onClick={() => {
                        posthog.capture("support_email_clicked");
                      }}
                    >
                      <EmailIcon className="w-5 h-5" />
                      ryan@teslanav.com
                    </a>
                  </div>
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

function EmailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );
}
