"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { TrackPoint, PlaybackState, GPXData } from "@/types/gpx";
import { parseGPX, interpolatePosition, calculateDuration } from "@/lib/gpx";

interface UseGPXPlayerOptions {
  /** Called when playback completes */
  onComplete?: () => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

interface UseGPXPlayerReturn {
  /** Current playback state */
  state: PlaybackState;
  /** Load GPX data from string */
  loadGPX: (gpxString: string) => void;
  /** Load GPX data from URL (Vercel Blob) */
  loadFromUrl: (url: string) => Promise<void>;
  /** Start or resume playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Reset to beginning */
  reset: () => void;
  /** Whether GPX is loaded and ready */
  isLoaded: boolean;
  /** Whether currently loading */
  isLoading: boolean;
  /** All track points for drawing the path */
  trackPoints: TrackPoint[];
  /** Bounds of the recording for map centering */
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
}

export function useGPXPlayer(options: UseGPXPlayerOptions = {}): UseGPXPlayerReturn {
  const { onComplete, onError } = options;
  
  const [state, setState] = useState<PlaybackState>({
    isPlaying: false,
    isComplete: false,
    currentTime: 0,
    duration: 0,
    currentPosition: null,
    progress: 0,
  });
  
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [bounds, setBounds] = useState<UseGPXPlayerReturn["bounds"]>(null);
  
  // Refs for animation
  const pointsRef = useRef<TrackPoint[]>([]);
  const startPlaybackTimeRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const durationRef = useRef<number>(0);
  const recordingStartTimeRef = useRef<number>(0);
  
  // Animation loop
  const animate = useCallback(() => {
    if (!startPlaybackTimeRef.current || pointsRef.current.length < 2) return;
    
    const now = Date.now();
    const elapsed = now - startPlaybackTimeRef.current + pausedAtRef.current;
    const points = pointsRef.current;
    const duration = durationRef.current;
    
    // Check if playback is complete
    if (elapsed >= duration) {
      const lastPoint = points[points.length - 1];
      setState(prev => ({
        ...prev,
        isPlaying: false,
        isComplete: true,
        currentTime: duration,
        progress: 1,
        currentPosition: {
          lat: lastPoint.lat,
          lon: lastPoint.lon,
          heading: lastPoint.heading ?? 0,
        },
      }));
      
      startPlaybackTimeRef.current = null;
      onComplete?.();
      return;
    }
    
    // Find the target time in recording timeline
    const targetTime = recordingStartTimeRef.current + elapsed;
    
    // Find the two points to interpolate between
    let pointA = points[0];
    let pointB = points[1];
    
    for (let i = 0; i < points.length - 1; i++) {
      const timeA = new Date(points[i].time).getTime();
      const timeB = new Date(points[i + 1].time).getTime();
      
      if (targetTime >= timeA && targetTime <= timeB) {
        pointA = points[i];
        pointB = points[i + 1];
        break;
      } else if (targetTime < timeA) {
        // Before first point
        pointA = points[i];
        pointB = points[i];
        break;
      } else if (i === points.length - 2) {
        // After last point
        pointA = points[i + 1];
        pointB = points[i + 1];
      }
    }
    
    // Interpolate position
    const position = interpolatePosition(pointA, pointB, targetTime);
    
    setState(prev => ({
      ...prev,
      currentTime: elapsed,
      progress: elapsed / duration,
      currentPosition: position,
    }));
    
    rafRef.current = requestAnimationFrame(animate);
  }, [onComplete]);
  
  const loadGPX = useCallback((gpxString: string) => {
    try {
      const gpxData: GPXData = parseGPX(gpxString);
      
      // Extract all points from all tracks and segments
      const allPoints: TrackPoint[] = [];
      for (const track of gpxData.tracks) {
        for (const segment of track.segments) {
          allPoints.push(...segment.points);
        }
      }
      
      if (allPoints.length < 2) {
        throw new Error("Recording must have at least 2 points");
      }
      
      // Sort by time just in case
      allPoints.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      
      pointsRef.current = allPoints;
      setTrackPoints(allPoints);
      
      // Calculate duration and bounds
      const duration = calculateDuration(allPoints);
      durationRef.current = duration;
      recordingStartTimeRef.current = new Date(allPoints[0].time).getTime();
      
      // Calculate bounds
      let minLat = allPoints[0].lat;
      let maxLat = allPoints[0].lat;
      let minLon = allPoints[0].lon;
      let maxLon = allPoints[0].lon;
      
      for (const point of allPoints) {
        minLat = Math.min(minLat, point.lat);
        maxLat = Math.max(maxLat, point.lat);
        minLon = Math.min(minLon, point.lon);
        maxLon = Math.max(maxLon, point.lon);
      }
      
      setBounds({ minLat, maxLat, minLon, maxLon });
      
      // Set initial state
      const firstPoint = allPoints[0];
      setState({
        isPlaying: false,
        isComplete: false,
        currentTime: 0,
        duration,
        progress: 0,
        currentPosition: {
          lat: firstPoint.lat,
          lon: firstPoint.lon,
          heading: firstPoint.heading ?? 0,
        },
      });
      
      setIsLoaded(true);
      pausedAtRef.current = 0;
      
    } catch (error) {
      console.error("Failed to parse GPX:", error);
      onError?.(error instanceof Error ? error : new Error("Failed to parse GPX"));
    }
  }, [onError]);
  
  const loadFromUrl = useCallback(async (url: string): Promise<void> => {
    setIsLoading(true);
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch GPX file");
      }
      
      const gpxString = await response.text();
      loadGPX(gpxString);
      
    } catch (error) {
      console.error("Failed to load GPX from URL:", error);
      onError?.(error instanceof Error ? error : new Error("Failed to load GPX"));
    } finally {
      setIsLoading(false);
    }
  }, [loadGPX, onError]);
  
  const play = useCallback(() => {
    if (!isLoaded || pointsRef.current.length < 2) return;
    
    // If complete, reset first
    if (state.isComplete) {
      pausedAtRef.current = 0;
    }
    
    startPlaybackTimeRef.current = Date.now();
    
    setState(prev => ({
      ...prev,
      isPlaying: true,
      isComplete: false,
    }));
    
    rafRef.current = requestAnimationFrame(animate);
  }, [isLoaded, state.isComplete, animate]);
  
  const pause = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    
    // Save current time for resume
    if (startPlaybackTimeRef.current) {
      pausedAtRef.current = Date.now() - startPlaybackTimeRef.current + pausedAtRef.current;
    }
    startPlaybackTimeRef.current = null;
    
    setState(prev => ({
      ...prev,
      isPlaying: false,
    }));
  }, []);
  
  const reset = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    
    startPlaybackTimeRef.current = null;
    pausedAtRef.current = 0;
    
    const firstPoint = pointsRef.current[0];
    
    setState(prev => ({
      ...prev,
      isPlaying: false,
      isComplete: false,
      currentTime: 0,
      progress: 0,
      currentPosition: firstPoint ? {
        lat: firstPoint.lat,
        lon: firstPoint.lon,
        heading: firstPoint.heading ?? 0,
      } : null,
    }));
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);
  
  return {
    state,
    loadGPX,
    loadFromUrl,
    play,
    pause,
    reset,
    isLoaded,
    isLoading,
    trackPoints,
    bounds,
  };
}
