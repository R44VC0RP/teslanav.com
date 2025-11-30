"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import posthog from "posthog-js";

interface SearchResult {
  id: string; // mapbox_id for retrieving coordinates
  place_name: string;
  center?: [number, number]; // [lng, lat] - only populated after selection
  address?: string;
  text: string;
}

interface NavigateSearchProps {
  isDarkMode?: boolean;
  onSelectDestination: (lng: number, lat: number, placeName: string) => void;
  onOpenChange?: (isOpen: boolean) => void;
  userLocation?: { latitude: number; longitude: number } | null;
}

export function NavigateSearch({
  isDarkMode = false,
  onSelectDestination,
  onOpenChange,
  userLocation,
}: NavigateSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false); // Loading state for coordinate fetch
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const sessionTokenRef = useRef<string | null>(null); // Track session token for billing

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery("");
        setResults([]);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Notify parent when open state changes
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Search with debounce - only fetches suggestions (no coordinates = saves API calls!)
  const searchPlaces = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const proximityParam = userLocation 
        ? `&proximity=${userLocation.longitude},${userLocation.latitude}`
        : "";

      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(searchQuery)}${proximityParam}`
      );

      if (!response.ok) throw new Error("Search failed");

      const data = await response.json();
      // Store session token for efficient billing when retrieving coordinates
      sessionTokenRef.current = data.sessionToken || null;
      setResults(data.features || []);
      setSelectedIndex(-1);
    } catch (error) {
      console.error("Geocoding error:", error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [userLocation]);

  // Handle input change with debounce
  const handleInputChange = (value: string) => {
    setQuery(value);
    
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      searchPlaces(value);
    }, 300);
  };

  // Handle selection - fetches coordinates only when user selects (saves ~10 API calls per search!)
  const handleSelect = async (result: SearchResult) => {
    setSelecting(true);
    
    try {
      // Fetch coordinates for the selected result
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapbox_id: result.id,
          session_token: sessionTokenRef.current,
        }),
      });

      if (!response.ok) throw new Error("Failed to get coordinates");

      const data = await response.json();
      const [lng, lat] = data.center;

      posthog.capture("destination_selected", {
        place_name: result.place_name,
        place_text: result.text,
      });

      onSelectDestination(lng, lat, result.text);
      setIsOpen(false);
      setQuery("");
      setResults([]);
      sessionTokenRef.current = null;
    } catch (error) {
      console.error("Failed to get coordinates:", error);
      // Show error to user - could add toast notification here
    } finally {
      setSelecting(false);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (selecting) return; // Prevent actions while fetching coordinates
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter" && selectedIndex >= 0 && results[selectedIndex]) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setQuery("");
      setResults([]);
    }
  };

  const buttonStyles = isDarkMode
    ? "bg-[#1a1a1a]/70 text-white border-white/10 hover:bg-[#1a1a1a]/90"
    : "bg-white/70 text-black border-black/5 hover:bg-white/90";

  const dropdownStyles = isDarkMode
    ? "bg-[#1a1a1a]/95 text-white border-white/10"
    : "bg-white/95 text-black border-black/10";

  const inputStyles = isDarkMode
    ? "bg-transparent text-white placeholder:text-gray-500"
    : "bg-transparent text-black placeholder:text-gray-400";

  const resultHoverStyles = isDarkMode
    ? "hover:bg-white/10"
    : "hover:bg-black/5";

  const subtextStyles = isDarkMode
    ? "text-gray-400"
    : "text-gray-500";

  if (!isOpen) {
    // Collapsed state - Tesla-style pill button
    return (
      <button
        onClick={() => {
          setIsOpen(true);
          posthog.capture("navigate_search_opened");
        }}
        className={`
          flex items-center gap-3 px-5 py-3 rounded-xl backdrop-blur-xl
          ${buttonStyles}
          shadow-lg border transition-all duration-200 
          hover:scale-[1.02] active:scale-[0.98]
        `}
      >
        <NavigateIcon className="w-5 h-5 opacity-70" />
        <span className="text-base font-medium">Navigate</span>
        <ChevronRightIcon className="w-5 h-5 opacity-50" />
      </button>
    );
  }

  // Expanded state - Search input with results
  return (
    <div ref={containerRef} className="relative">
      {/* Search Input */}
      <div
        className={`
          flex items-center gap-3 px-5 py-3 rounded-2xl backdrop-blur-xl
          ${dropdownStyles}
          shadow-xl border transition-all duration-200
          min-w-[360px]
        `}
      >
        <NavigateIcon className={`w-5 h-5 flex-shrink-0 ${isDarkMode ? "text-blue-400" : "text-blue-500"}`} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search places or addresses..."
          className={`
            flex-1 text-base font-medium outline-none
            ${inputStyles}
          `}
        />
        {(loading || selecting) && (
          <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-50" />
        )}
        {query && !loading && !selecting && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              inputRef.current?.focus();
            }}
            className="opacity-50 hover:opacity-100 transition-opacity"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {results.length > 0 && (
        <div
          className={`
            absolute top-full left-0 right-0 mt-2 rounded-2xl backdrop-blur-xl
            ${dropdownStyles}
            shadow-xl border overflow-hidden
            max-h-[300px] overflow-y-auto
          `}
        >
          {results.map((result, index) => (
            <button
              key={result.id}
              onClick={() => handleSelect(result)}
              className={`
                w-full px-4 py-3 text-left flex items-start gap-3
                ${resultHoverStyles}
                ${selectedIndex === index ? (isDarkMode ? "bg-white/10" : "bg-black/5") : ""}
                transition-colors duration-100
                border-b last:border-b-0 ${isDarkMode ? "border-white/5" : "border-black/5"}
              `}
            >
              <LocationPinIcon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{result.text}</div>
                <div className={`text-xs truncate ${subtextStyles}`}>
                  {result.place_name}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No results state */}
      {query.length >= 2 && !loading && results.length === 0 && (
        <div
          className={`
            absolute top-full left-0 right-0 mt-2 px-4 py-3 rounded-2xl backdrop-blur-xl
            ${dropdownStyles}
            shadow-xl border text-center
          `}
        >
          <span className={`text-sm ${subtextStyles}`}>No results found</span>
        </div>
      )}
    </div>
  );
}

function NavigateIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function LocationPinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}

