"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  error: string | null;
  loading: boolean;
  // Calculated/interpolated values for smooth animation
  calculatedHeading: number | null;
  timestamp: number | null;
}

// Calculate bearing between two points in degrees (0-360, where 0 is north)
function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

// Calculate distance between two points in meters using Haversine formula
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Normalize angle difference to -180 to 180 range
function normalizeAngleDiff(angle: number): number {
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

// Smoothly interpolate between two angles
function lerpAngle(from: number, to: number, t: number): number {
  const diff = normalizeAngleDiff(to - from);
  return (from + diff * t + 360) % 360;
}

export function useGeolocation(enableHighAccuracy = true) {
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    heading: null,
    speed: null,
    error: null,
    loading: true,
    calculatedHeading: null,
    timestamp: null,
  });

  const [watchId, setWatchId] = useState<number | null>(null);
  
  // Store previous positions for bearing calculation
  const prevPositionRef = useRef<{
    lat: number;
    lon: number;
    timestamp: number;
  } | null>(null);
  
  // Store the last calculated heading for smoothing
  const lastHeadingRef = useRef<number | null>(null);
  
  // Minimum distance (meters) to travel before updating heading
  const MIN_DISTANCE_FOR_HEADING = 3;
  
  // Minimum speed (m/s) to consider for heading calculation (~5 km/h)
  const MIN_SPEED_FOR_HEADING = 1.4;

  const updatePosition = useCallback((position: GeolocationPosition) => {
    const { latitude, longitude, heading: geoHeading, speed, accuracy } = position.coords;
    const timestamp = position.timestamp;
    
    let calculatedHeading: number | null = null;
    
    // Try to use GPS heading first (only valid when moving)
    if (geoHeading !== null && !isNaN(geoHeading) && speed !== null && speed > MIN_SPEED_FOR_HEADING) {
      calculatedHeading = geoHeading;
    }
    // Otherwise, calculate from movement
    else if (prevPositionRef.current) {
      const prev = prevPositionRef.current;
      const distance = calculateDistance(prev.lat, prev.lon, latitude, longitude);
      const timeDelta = (timestamp - prev.timestamp) / 1000; // seconds
      
      // Only calculate heading if we've moved enough and have reasonable time delta
      if (distance > MIN_DISTANCE_FOR_HEADING && timeDelta > 0 && timeDelta < 30) {
        const rawHeading = calculateBearing(prev.lat, prev.lon, latitude, longitude);
        
        // Smooth the heading transition
        if (lastHeadingRef.current !== null) {
          calculatedHeading = lerpAngle(lastHeadingRef.current, rawHeading, 0.3);
        } else {
          calculatedHeading = rawHeading;
        }
      } else {
        // Keep the previous heading if we haven't moved enough
        calculatedHeading = lastHeadingRef.current;
      }
    }
    
    // Update refs
    if (calculatedHeading !== null) {
      lastHeadingRef.current = calculatedHeading;
    }
    
    // Always update previous position for next calculation
    prevPositionRef.current = { lat: latitude, lon: longitude, timestamp };

    setState({
      latitude,
      longitude,
      accuracy,
      heading: geoHeading,
      speed,
      error: null,
      loading: false,
      calculatedHeading,
      timestamp,
    });
  }, []);

  const handleError = useCallback((error: GeolocationPositionError) => {
    setState((prev) => ({
      ...prev,
      error: error.message,
      loading: false,
    }));
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        error: "Geolocation is not supported",
        loading: false,
      }));
      return;
    }

    const options: PositionOptions = {
      enableHighAccuracy,
      timeout: 10000,
      maximumAge: 0, // Always get fresh position
    };

    // Get initial position
    navigator.geolocation.getCurrentPosition(updatePosition, handleError, options);

    // Watch for position changes - this fires as frequently as the device allows
    const id = navigator.geolocation.watchPosition(updatePosition, handleError, options);
    setWatchId(id);

    return () => {
      if (id) {
        navigator.geolocation.clearWatch(id);
      }
    };
  }, [enableHighAccuracy, updatePosition, handleError]);

  const stopWatching = useCallback(() => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
    }
  }, [watchId]);

  // Return the best available heading (GPS heading if moving fast enough, otherwise calculated)
  const bestHeading = state.heading !== null && state.speed !== null && state.speed > MIN_SPEED_FOR_HEADING
    ? state.heading
    : state.calculatedHeading;

  return { 
    ...state, 
    stopWatching,
    // Provide the best heading source
    effectiveHeading: bestHeading,
  };
}
