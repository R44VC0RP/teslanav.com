"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { TrackPoint, RecordingState, RecordingSession } from "@/types/gpx";
import {
  generateGPX,
  calculateBounds,
  calculateDuration,
  generateRecordingName,
  generateUUID,
  getOrCreateSessionToken,
} from "@/lib/gpx";

const RECORDING_INTERVAL_MS = 1000; // Record every 1 second
const SESSIONS_STORAGE_KEY = "teslanav-recordings";

interface UseGPXRecorderOptions {
  /** Called when recording is saved successfully */
  onSaved?: (session: RecordingSession) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

interface UseGPXRecorderReturn {
  /** Current recording state */
  state: RecordingState;
  /** Start recording */
  startRecording: () => void;
  /** Stop recording and save */
  stopRecording: () => Promise<RecordingSession | null>;
  /** Add a point manually (called from geolocation updates) */
  addPoint: (point: Omit<TrackPoint, "time">) => void;
  /** Discard current recording without saving */
  discardRecording: () => void;
  /** Get all saved sessions for this device */
  getSessions: () => RecordingSession[];
  /** Delete a saved session */
  deleteSession: (id: string) => Promise<void>;
  /** Whether we're currently saving */
  isSaving: boolean;
}

export function useGPXRecorder(options: UseGPXRecorderOptions = {}): UseGPXRecorderReturn {
  const { onSaved, onError } = options;
  
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    startTime: null,
    elapsedTime: 0,
    pointCount: 0,
    points: [],
  });
  
  const [isSaving, setIsSaving] = useState(false);
  
  // Refs for tracking state without re-renders
  const pointsRef = useRef<TrackPoint[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastPointTimeRef = useRef<number>(0);
  
  // Update elapsed time every second while recording
  useEffect(() => {
    if (state.isRecording && !state.isPaused) {
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setState(prev => ({
            ...prev,
            elapsedTime: Date.now() - startTimeRef.current!,
          }));
        }
      }, 1000);
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state.isRecording, state.isPaused]);
  
  const startRecording = useCallback(() => {
    const now = Date.now();
    startTimeRef.current = now;
    pointsRef.current = [];
    lastPointTimeRef.current = 0;
    
    setState({
      isRecording: true,
      isPaused: false,
      startTime: now,
      elapsedTime: 0,
      pointCount: 0,
      points: [],
    });
  }, []);
  
  const addPoint = useCallback((pointData: Omit<TrackPoint, "time">) => {
    if (!state.isRecording || state.isPaused) return;
    
    const now = Date.now();
    
    // Only add point if enough time has passed since last point
    if (now - lastPointTimeRef.current < RECORDING_INTERVAL_MS) {
      return;
    }
    
    lastPointTimeRef.current = now;
    
    const point: TrackPoint = {
      ...pointData,
      time: new Date(now).toISOString(),
    };
    
    pointsRef.current.push(point);
    
    setState(prev => ({
      ...prev,
      pointCount: pointsRef.current.length,
      points: [...pointsRef.current],
    }));
  }, [state.isRecording, state.isPaused]);
  
  const stopRecording = useCallback(async (): Promise<RecordingSession | null> => {
    if (!state.isRecording) return null;
    
    // Stop the timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    const points = pointsRef.current;
    
    // Need at least 2 points for a valid recording
    if (points.length < 2) {
      setState({
        isRecording: false,
        isPaused: false,
        startTime: null,
        elapsedTime: 0,
        pointCount: 0,
        points: [],
      });
      onError?.(new Error("Recording too short - need at least 2 points"));
      return null;
    }
    
    setIsSaving(true);
    
    try {
      const name = generateRecordingName();
      const gpxString = generateGPX(points, name);
      const sessionToken = getOrCreateSessionToken();
      
      // Upload to Vercel Blob via API
      const response = await fetch("/api/recording", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gpx: gpxString,
          name,
          sessionToken,
        }),
      });
      
      if (!response.ok) {
        throw new Error("Failed to save recording");
      }
      
      const { blobUrl } = await response.json();
      
      // Create session metadata
      const session: RecordingSession = {
        id: generateUUID(),
        name,
        createdAt: new Date().toISOString(),
        duration: calculateDuration(points),
        pointCount: points.length,
        blobUrl,
        sessionToken,
        bounds: calculateBounds(points),
      };
      
      // Save to localStorage
      const sessions = getSavedSessions();
      sessions.unshift(session); // Add to beginning
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
      
      // Reset state
      setState({
        isRecording: false,
        isPaused: false,
        startTime: null,
        elapsedTime: 0,
        pointCount: 0,
        points: [],
      });
      
      pointsRef.current = [];
      startTimeRef.current = null;
      
      onSaved?.(session);
      return session;
      
    } catch (error) {
      console.error("Failed to save recording:", error);
      onError?.(error instanceof Error ? error : new Error("Failed to save recording"));
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [state.isRecording, onSaved, onError]);
  
  const discardRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    pointsRef.current = [];
    startTimeRef.current = null;
    
    setState({
      isRecording: false,
      isPaused: false,
      startTime: null,
      elapsedTime: 0,
      pointCount: 0,
      points: [],
    });
  }, []);
  
  const getSessions = useCallback((): RecordingSession[] => {
    return getSavedSessions();
  }, []);
  
  const deleteSession = useCallback(async (id: string): Promise<void> => {
    const sessions = getSavedSessions();
    const session = sessions.find(s => s.id === id);
    
    if (session) {
      // Delete from Vercel Blob via API
      try {
        await fetch(`/api/recording/${id}`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ blobUrl: session.blobUrl }),
        });
      } catch (error) {
        console.error("Failed to delete blob:", error);
        // Continue to remove from localStorage even if blob deletion fails
      }
    }
    
    // Remove from localStorage
    const updatedSessions = sessions.filter(s => s.id !== id);
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(updatedSessions));
  }, []);
  
  return {
    state,
    startRecording,
    stopRecording,
    addPoint,
    discardRecording,
    getSessions,
    deleteSession,
    isSaving,
  };
}

/**
 * Get saved sessions from localStorage
 */
function getSavedSessions(): RecordingSession[] {
  if (typeof window === "undefined") return [];
  
  try {
    const stored = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!stored) return [];
    
    const sessions: RecordingSession[] = JSON.parse(stored);
    const sessionToken = getOrCreateSessionToken();
    
    // Filter to only show sessions from this device
    return sessions.filter(s => s.sessionToken === sessionToken);
  } catch (error) {
    console.error("Failed to load sessions:", error);
    return [];
  }
}
