"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Map, type MapRef } from "@/components/Map";
import { useGPXPlayer } from "@/hooks/useGPXPlayer";
import { formatDuration, getOrCreateSessionToken } from "@/lib/gpx";
import type { RecordingSession } from "@/types/gpx";
import Link from "next/link";

const SESSIONS_STORAGE_KEY = "teslanav-recordings";

// Load sessions from localStorage (lazy initialization)
function loadSessionsFromStorage(): RecordingSession[] {
  if (typeof window === "undefined") return [];
  
  try {
    const stored = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (stored) {
      const allSessions: RecordingSession[] = JSON.parse(stored);
      const sessionToken = getOrCreateSessionToken();
      return allSessions.filter(s => s.sessionToken === sessionToken);
    }
  } catch (error) {
    console.error("Failed to load sessions:", error);
  }
  return [];
}

export default function ViewPage() {
  const mapRef = useRef<MapRef>(null);
  const [sessions, setSessions] = useState<RecordingSession[]>(loadSessionsFromStorage);
  const [selectedSession, setSelectedSession] = useState<RecordingSession | null>(null);
  const [showTrackLine, setShowTrackLine] = useState(true);
  
  const {
    state: playbackState,
    loadFromUrl,
    play,
    pause,
    reset,
    isLoaded,
    isLoading,
    trackPoints,
    bounds,
  } = useGPXPlayer({
    onComplete: () => {
      console.log("Playback complete");
    },
    onError: (error) => {
      console.error("Playback error:", error);
      alert(error.message);
    },
  });

  // Load a session for playback
  const handleSelectSession = useCallback(async (session: RecordingSession) => {
    setSelectedSession(session);
    await loadFromUrl(session.blobUrl);
  }, [loadFromUrl]);

  // Center map and auto-play when loaded
  useEffect(() => {
    if (isLoaded && bounds && mapRef.current) {
      const centerLat = (bounds.minLat + bounds.maxLat) / 2;
      const centerLon = (bounds.minLon + bounds.maxLon) / 2;
      mapRef.current.recenter(centerLon, centerLat);
      
      // Auto-start playback after a brief delay for map to settle
      const timer = setTimeout(() => {
        play();
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [isLoaded, bounds, play]);

  // Follow the playback position
  useEffect(() => {
    if (playbackState.isPlaying && playbackState.currentPosition && mapRef.current) {
      mapRef.current.recenter(
        playbackState.currentPosition.lon,
        playbackState.currentPosition.lat
      );
    }
  }, [playbackState.isPlaying, playbackState.currentPosition]);

  // Delete a session
  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (!confirm("Delete this recording?")) return;
    
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      // Delete from blob
      try {
        await fetch(`/api/recording/${sessionId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobUrl: session.blobUrl }),
        });
      } catch (error) {
        console.error("Failed to delete blob:", error);
      }
    }
    
    // Remove from localStorage and state
    const updatedSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(updatedSessions);
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(updatedSessions));
    
    // Clear playback if this was the selected session
    if (selectedSession?.id === sessionId) {
      setSelectedSession(null);
      reset();
    }
  }, [sessions, selectedSession, reset]);

  // Build route data for the track line visualization
  const trackRoute = trackPoints.length > 1 && showTrackLine ? {
    id: "track",
    geometry: {
      type: "LineString" as const,
      coordinates: trackPoints.map(p => [p.lon, p.lat] as [number, number]),
    },
    distance: 0,
    duration: 0,
    steps: [],
    summary: "Recorded track",
  } : null;

  // Session list view (before playback)
  if (!isLoaded) {
    return (
      <main className="relative w-full h-full bg-gray-50">
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-30 bg-white border-b border-gray-200">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Link
                href="/record"
                className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeftIcon className="w-4 h-4" />
                <span className="text-sm font-medium">Back</span>
              </Link>
              <h1 className="text-xl font-semibold text-gray-900">Recordings</h1>
            </div>
          </div>
        </div>

        {/* Session list */}
        <div className="pt-20 px-6 pb-6 max-w-2xl mx-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}

          {!isLoading && sessions.length === 0 && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <RecordIcon className="w-8 h-8 text-gray-400" />
              </div>
              <h2 className="text-lg font-medium text-gray-900 mb-2">No recordings yet</h2>
              <p className="text-gray-500 mb-6">Start recording your trips to view them here.</p>
              <Link
                href="/record"
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium transition-colors"
              >
                <RecordIcon className="w-5 h-5" />
                Start Recording
              </Link>
            </div>
          )}

          {!isLoading && sessions.length > 0 && (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
                >
                  <button
                    onClick={() => handleSelectSession(session)}
                    className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 truncate">{session.name}</h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                          <span>{formatDuration(session.duration)}</span>
                          <span>{session.pointCount} points</span>
                          <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <PlayCircleIcon className="w-10 h-10 text-blue-500 flex-shrink-0" />
                    </div>
                  </button>
                  <div className="flex border-t border-gray-100">
                    <button
                      onClick={() => handleDeleteSession(session.id)}
                      className="flex-1 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <TrashIcon className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

  // Playback view (map only with minimal controls)
  return (
    <main className="relative w-full h-full">
      {/* Map with track line and current position */}
      <Map
        ref={mapRef}
        center={playbackState.currentPosition ? [playbackState.currentPosition.lon, playbackState.currentPosition.lat] : undefined}
        zoom={16}
        isDarkMode={false}
        userLocation={playbackState.currentPosition ? {
          latitude: playbackState.currentPosition.lat,
          longitude: playbackState.currentPosition.lon,
          heading: playbackState.currentPosition.heading,
          effectiveHeading: playbackState.currentPosition.heading,
          speed: null,
        } : null}
        followMode={playbackState.isPlaying}
        showTraffic={false}
        useSatellite={false}
        showAvatarPulse={false}
        routes={trackRoute ? [trackRoute] : undefined}
        selectedRouteIndex={0}
      />

      {/* Replay button - shows when playback is complete */}
      {playbackState.isComplete && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30">
          <button
            onClick={() => {
              reset();
              play();
            }}
            className="flex items-center gap-3 px-8 py-4 bg-white/95 backdrop-blur-xl hover:bg-white text-gray-900 rounded-2xl shadow-2xl border border-gray-200 transition-all duration-200 hover:scale-105 active:scale-95"
          >
            <ReplayIcon className="w-6 h-6" />
            <span className="text-lg font-semibold">Replay</span>
          </button>
        </div>
      )}

      {/* Minimal controls overlay - top */}
      <div className="absolute top-6 left-6 right-6 z-30 flex items-start justify-between">
        {/* Back button */}
        <button
          onClick={() => {
            pause();
            reset();
            setSelectedSession(null);
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-white/95 backdrop-blur-xl hover:bg-gray-50 text-gray-700 rounded-xl shadow-lg border border-gray-200 transition-all duration-200"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          <span className="text-sm font-medium">Sessions</span>
        </button>

        {/* Track line toggle */}
        <button
          onClick={() => setShowTrackLine(!showTrackLine)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg border transition-all duration-200 ${
            showTrackLine 
              ? "bg-blue-500 text-white border-blue-400" 
              : "bg-white/95 backdrop-blur-xl text-gray-700 border-gray-200"
          }`}
        >
          <RouteIcon className="w-4 h-4" />
          <span className="text-sm font-medium">Track</span>
        </button>
      </div>


    </main>
  );
}

// Icons

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}

function RecordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

function PlayCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function ReplayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function RouteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  );
}
