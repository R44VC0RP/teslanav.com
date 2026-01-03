"use client";

import { useEffect, useCallback, useRef } from "react";
import { Map, type MapRef } from "@/components/Map";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useGPXRecorder } from "@/hooks/useGPXRecorder";
import { formatDuration, generateGPX, downloadGPX } from "@/lib/gpx";
import type { RecordingSession } from "@/types/gpx";
import Link from "next/link";

export default function RecordPage() {
  const mapRef = useRef<MapRef>(null);
  
  const { 
    latitude, 
    longitude, 
    effectiveHeading, 
    speed,
    accuracy,
    error: geoError 
  } = useGeolocation();
  
  const {
    state: recordingState,
    startRecording,
    stopRecording,
    addPoint,
    discardRecording,
    isSaving,
  } = useGPXRecorder({
    onSaved: (session: RecordingSession) => {
      console.log("Recording saved:", session.name);
    },
    onError: (error: Error) => {
      console.error("Recording error:", error);
      alert(error.message);
    },
  });

  // Add points as we receive location updates
  useEffect(() => {
    if (recordingState.isRecording && latitude && longitude) {
      addPoint({
        lat: latitude,
        lon: longitude,
        heading: effectiveHeading ?? undefined,
        speed: speed ?? undefined,
        accuracy: accuracy ?? undefined,
      });
    }
  }, [recordingState.isRecording, latitude, longitude, effectiveHeading, speed, accuracy, addPoint]);

  const handleStartRecording = useCallback(() => {
    startRecording();
    // Enable follow mode for better recording experience
    if (mapRef.current && latitude && longitude) {
      mapRef.current.setFollowMode(true);
      mapRef.current.recenter(longitude, latitude);
    }
  }, [startRecording, latitude, longitude]);

  const handleStopRecording = useCallback(async () => {
    const session = await stopRecording();
    if (session) {
      // Offer to download the GPX file
      const gpxString = generateGPX(recordingState.points, session.name);
      downloadGPX(gpxString, session.name);
    }
  }, [stopRecording, recordingState.points]);

  // Show loading screen until we have location
  if (!latitude || !longitude) {
    return (
      <main className="relative w-full h-full bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
            <span className="text-gray-600 text-sm font-medium">
              {geoError ? geoError : "Finding your location..."}
            </span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative w-full h-full">
      {/* Map - Light mode, minimal */}
      <Map
        ref={mapRef}
        center={[longitude, latitude]}
        zoom={16}
        isDarkMode={false}
        userLocation={{ 
          latitude, 
          longitude, 
          heading: null,
          effectiveHeading, 
          speed 
        }}
        followMode={recordingState.isRecording}
        showTraffic={false}
        useSatellite={false}
        showAvatarPulse={true}
      />

      {/* Recording indicator - top center */}
      {recordingState.isRecording && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30">
          <div className="flex items-center gap-3 px-5 py-3 bg-white/95 backdrop-blur-xl rounded-2xl shadow-lg border border-gray-200">
            {/* Pulsing red dot */}
            <div className="relative">
              <div className="w-4 h-4 bg-red-500 rounded-full" />
              <div className="absolute inset-0 w-4 h-4 bg-red-500 rounded-full animate-ping opacity-75" />
            </div>
            {/* Timer */}
            <span className="text-2xl font-mono font-bold text-gray-900 tabular-nums">
              {formatDuration(recordingState.elapsedTime)}
            </span>
            {/* Point count */}
            <span className="text-sm text-gray-500">
              {recordingState.pointCount} pts
            </span>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
        <div className="flex items-center gap-3">
          {/* Not recording - show Start button */}
          {!recordingState.isRecording && (
            <>
              <button
                onClick={handleStartRecording}
                className="flex items-center gap-3 px-8 py-4 bg-red-500 hover:bg-red-600 text-white rounded-2xl shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <div className="w-5 h-5 bg-white rounded-full" />
                <span className="text-lg font-semibold">Start Recording</span>
              </button>
              
              {/* View recordings link */}
              <Link
                href="/view"
                className="flex items-center gap-2 px-6 py-4 bg-white/95 backdrop-blur-xl hover:bg-gray-50 text-gray-700 rounded-2xl shadow-lg border border-gray-200 transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <PlayIcon className="w-5 h-5" />
                <span className="font-medium">View Recordings</span>
              </Link>
            </>
          )}

          {/* Recording - show Stop button */}
          {recordingState.isRecording && (
            <>
              <button
                onClick={handleStopRecording}
                disabled={isSaving}
                className="flex items-center gap-3 px-8 py-4 bg-gray-900 hover:bg-gray-800 text-white rounded-2xl shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span className="text-lg font-semibold">Saving...</span>
                  </>
                ) : (
                  <>
                    <div className="w-5 h-5 bg-white rounded-sm" />
                    <span className="text-lg font-semibold">Stop Recording</span>
                  </>
                )}
              </button>
              
              <button
                onClick={discardRecording}
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-4 bg-white/95 backdrop-blur-xl hover:bg-red-50 text-gray-700 hover:text-red-600 rounded-2xl shadow-lg border border-gray-200 transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                <TrashIcon className="w-5 h-5" />
                <span className="font-medium">Discard</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Back to main app link - top left */}
      <div className="absolute top-6 left-6 z-30">
        <Link
          href="/"
          className="flex items-center gap-2 px-4 py-2.5 bg-white/95 backdrop-blur-xl hover:bg-gray-50 text-gray-700 rounded-xl shadow-lg border border-gray-200 transition-all duration-200 hover:scale-105 active:scale-95"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          <span className="text-sm font-medium">Back</span>
        </Link>
      </div>

      {/* GPS accuracy indicator - top right */}
      <div className="absolute top-6 right-6 z-30">
        <div className="px-4 py-2.5 bg-white/95 backdrop-blur-xl rounded-xl shadow-lg border border-gray-200">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${
              accuracy && accuracy < 10 ? 'bg-green-500' :
              accuracy && accuracy < 30 ? 'bg-yellow-500' :
              'bg-red-500'
            }`} />
            <span className="text-sm text-gray-600">
              GPS: {accuracy ? `${Math.round(accuracy)}m` : 'Unknown'}
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
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

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}
