"use client";

import type { RouteData } from "@/types/route";

interface RouteSelectorProps {
  routes: RouteData[];
  selectedIndex: number;
  onSelectRoute: (index: number) => void;
  isDarkMode?: boolean;
}

// Format duration in seconds to human-readable string
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} min`;
}

// Format distance in meters to miles
function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  if (miles >= 10) {
    return `${Math.round(miles)} mi`;
  }
  return `${miles.toFixed(1)} mi`;
}

// Get label for route (Fastest, Alternative, etc.)
function getRouteLabel(index: number, routes: RouteData[]): string {
  if (index === 0) {
    return "Fastest";
  }
  
  // Check if this route is significantly different
  const fastest = routes[0];
  const current = routes[index];
  
  // If this route is shorter in distance but longer in time
  if (current.distance < fastest.distance && current.duration > fastest.duration) {
    return "Shortest";
  }
  
  // If this route avoids highways (simpler check - fewer steps often means main roads)
  if (current.steps.length < fastest.steps.length * 0.7) {
    return "Simpler";
  }
  
  return "Alternative";
}

export function RouteSelector({
  routes,
  selectedIndex,
  onSelectRoute,
  isDarkMode = false,
}: RouteSelectorProps) {
  if (routes.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-2">
      {routes.map((route, index) => {
        const isSelected = index === selectedIndex;
        const label = getRouteLabel(index, routes);
        const timeDiff = index > 0 
          ? Math.round((route.duration - routes[0].duration) / 60)
          : 0;

        return (
          <button
            key={route.id}
            onClick={() => onSelectRoute(index)}
            className={`
              w-full flex items-center gap-3 px-3 py-3 rounded-xl
              transition-all duration-150
              ${isSelected 
                ? isDarkMode 
                  ? "bg-blue-500/25" 
                  : "bg-blue-500/20"
                : isDarkMode 
                  ? "hover:bg-white/10" 
                  : "hover:bg-black/10"
              }
            `}
          >
            {/* Selection indicator */}
            <div 
              className={`
                w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0
                transition-colors duration-150
                ${isSelected 
                  ? "border-blue-500 bg-blue-500" 
                  : isDarkMode 
                    ? "border-gray-400" 
                    : "border-gray-500"
                }
              `}
            >
              {isSelected && (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </div>

            {/* Route info */}
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center gap-2">
                <span className={`font-bold text-base ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                  {formatDuration(route.duration)}
                </span>
                <span className={`text-sm font-medium ${isDarkMode ? "text-gray-200" : "text-gray-700"}`}>
                  · {formatDistance(route.distance)}
                </span>
                {timeDiff > 0 && (
                  <span className={`text-xs font-semibold ${isDarkMode ? "text-amber-400" : "text-amber-600"}`}>
                    +{timeDiff} min
                  </span>
                )}
              </div>
              <div className={`text-sm truncate ${isDarkMode ? "text-gray-300" : "text-gray-600"}`}>
                {route.summary}
              </div>
            </div>

            {/* Label badge */}
            <span
              className={`
                text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0
                ${isSelected 
                  ? "bg-blue-500 text-white" 
                  : isDarkMode 
                    ? "bg-white/15 text-gray-200" 
                    : "bg-black/10 text-gray-700"
                }
              `}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

