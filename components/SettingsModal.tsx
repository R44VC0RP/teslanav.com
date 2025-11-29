"use client";

import posthog from "posthog-js";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  showWazeAlerts: boolean;
  onToggleWazeAlerts: (value: boolean) => void;
  showTraffic: boolean;
  onToggleTraffic: (value: boolean) => void;
  useSatellite: boolean;
  onToggleSatellite: (value: boolean) => void;
  showAvatarPulse: boolean;
  onToggleAvatarPulse: (value: boolean) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  isDarkMode,
  showWazeAlerts,
  onToggleWazeAlerts,
  showTraffic,
  onToggleTraffic,
  useSatellite,
  onToggleSatellite,
  showAvatarPulse,
  onToggleAvatarPulse,
}: SettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className={`
          relative w-[80%] h-[80%] rounded-2xl overflow-hidden
          ${isDarkMode ? "bg-[#1a1a1a] text-white" : "bg-white text-black"}
          shadow-2xl flex flex-col
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`
          flex items-center justify-between px-6 py-4 border-b
          ${isDarkMode ? "border-white/10" : "border-black/10"}
        `}>
          <h2 className="text-xl font-semibold">Settings</h2>
          <button
            onClick={() => {
              onClose();
              // Track settings closed event
              posthog.capture("settings_closed");
            }}
            className={`
              w-10 h-10 rounded-xl flex items-center justify-center
              ${isDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"}
              transition-colors
            `}
            aria-label="Close settings"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-lg mx-auto space-y-6">
            {/* Map Style Section */}
            <div>
              <h3 className={`text-sm font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Map Style
              </h3>
              
              <div className="space-y-4">
                {/* Satellite Toggle */}
                <div className={`
                  flex items-center justify-between p-4 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🛰️</span>
                    <div>
                      <div className="font-medium">Satellite View</div>
                      <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
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
              <h3 className={`text-sm font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Map Layers
              </h3>
              
              <div className="space-y-4">
                {/* Waze Alerts Toggle */}
                <div className={`
                  flex items-center justify-between p-4 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🚔</span>
                    <div>
                      <div className="font-medium">Waze Alerts</div>
                      <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
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

                {/* Traffic Toggle */}
                <div className={`
                  flex items-center justify-between p-4 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🚗</span>
                    <div>
                      <div className="font-medium">Traffic Layer</div>
                      <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        Show real-time traffic conditions
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

            {/* Appearance Section */}
            <div>
              <h3 className={`text-sm font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                Appearance
              </h3>
              
              <div className="space-y-4">
                {/* Avatar Pulse Toggle */}
                <div className={`
                  flex items-center justify-between p-4 rounded-xl
                  ${isDarkMode ? "bg-white/5" : "bg-black/5"}
                `}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">💫</span>
                    <div>
                      <div className="font-medium">Location Pulse</div>
                      <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
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
              <h3 className={`text-sm font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                About
              </h3>
              <div className={`
                p-4 rounded-xl
                ${isDarkMode ? "bg-white/5" : "bg-black/5"}
              `}>
                <div className="font-medium">TeslaNav</div>
                <div className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Navigation with Waze alerts for Tesla
                </div>
                <div className={`text-sm mt-2 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
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
        relative w-14 h-8 rounded-full transition-colors duration-200
        ${enabled 
          ? "bg-blue-500" 
          : isDarkMode ? "bg-white/20" : "bg-black/20"
        }
      `}
      aria-label={enabled ? "Disable" : "Enable"}
    >
      <div
        className={`
          absolute top-1 w-6 h-6 rounded-full bg-white shadow-md
          transition-transform duration-200
          ${enabled ? "translate-x-7" : "translate-x-1"}
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
