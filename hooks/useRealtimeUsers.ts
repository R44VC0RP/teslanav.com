"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRealtime } from "@/lib/realtime-client";
import type { UserPosition } from "@/lib/realtime";

// Car colors available in /public/cars/
const CAR_COLORS = ["blue", "green", "pink", "white", "yellow", "christmas"] as const;
export type CarColor = (typeof CAR_COLORS)[number];

// Configuration for cost optimization and privacy
// NOTE: Designed for long-lived sessions (e.g., Tesla browser running for hours)
// - Upstash Realtime handles reconnections automatically
// - Queue is bounded to prevent memory growth
// - Stale users cleaned up periodically
const CONFIG = {
  // PRIVACY: Delay position sharing by 5 minutes so people can't track others in real-time
  PRIVACY_DELAY_MS: 5 * 60 * 1000, // 5 minutes
  // How often to check and emit delayed positions (ms)
  DELAY_CHECK_INTERVAL_MS: 10000, // Check every 10 seconds
  // Only emit if user moved at least this many meters
  MIN_DISTANCE_CHANGE: 5,
  // Only emit if heading changed at least this many degrees
  MIN_HEADING_CHANGE: 10,
  // Maximum queue rate (ms between adding to queue)
  QUEUE_THROTTLE_MS: 5000, // Only queue every 5 seconds to reduce data
  // Maximum queue size to prevent unbounded memory growth in long sessions
  MAX_QUEUE_SIZE: 100, // ~8 min of positions at 5-sec intervals
  // Remove users who haven't updated in this time (ms) - longer due to delay
  STALE_USER_TIMEOUT_MS: 10 * 60 * 1000, // 10 minutes (accounts for 5 min delay)
  // How often to clean up stale users (ms)
  CLEANUP_INTERVAL_MS: 30000,
  // Heartbeat interval - queue position even if not moving to stay "alive" (ms)
  HEARTBEAT_INTERVAL_MS: 60000, // 1 minute
  
  // PRESENCE: Real-time "I'm here" pings (no location data, no privacy delay)
  PRESENCE_PING_INTERVAL_MS: 30000, // Ping every 30 seconds
  PRESENCE_STALE_MS: 60000, // Consider user offline after 60 seconds without ping
  PRESENCE_CLEANUP_INTERVAL_MS: 15000, // Clean up stale presence every 15 seconds
};

// Queued position with timestamp for delayed emission
interface QueuedPosition {
  data: {
    id: string;
    lat: number;
    lng: number;
    h: number | null;
    c: string;
  };
  queuedAt: number;
}

// Track other users with their last update time
interface TrackedUser extends UserPosition {
  lastUpdate: number;
}

interface UseRealtimeUsersOptions {
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  enabled?: boolean;
}

interface UseRealtimeUsersReturn {
  otherUsers: UserPosition[];
  userId: string | null;
  carColor: CarColor;
  connectionStatus: string;
  liveCount: number; // Real-time presence count (no delay)
  nearbyCount: number; // Users with delayed positions visible
}

// Generate a random user ID
function generateUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Get a random car color
function getRandomCarColor(): CarColor {
  return CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
}

// Calculate distance between two points in meters (Haversine formula)
function getDistanceInMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Get heading difference (accounts for 360° wraparound)
function getHeadingDiff(h1: number | null, h2: number | null): number {
  if (h1 === null || h2 === null) return 0;
  let diff = Math.abs(h1 - h2);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

export function useRealtimeUsers({
  latitude,
  longitude,
  heading,
  enabled = true,
}: UseRealtimeUsersOptions): UseRealtimeUsersReturn {
  // User identity - persisted in localStorage
  const [userId, setUserId] = useState<string | null>(null);
  const [carColor, setCarColor] = useState<CarColor>("blue");

  // Track other users (delayed positions)
  const [otherUsers, setOtherUsers] = useState<Map<string, TrackedUser>>(new Map());
  
  // Track live presence (real-time, no location data)
  const [liveUsers, setLiveUsers] = useState<Map<string, number>>(new Map()); // userId -> lastPingTime

  // Queue for delayed position emission (privacy feature)
  const positionQueueRef = useRef<QueuedPosition[]>([]);
  
  // Refs for throttling
  const lastQueuedRef = useRef<{ lat: number; lng: number; h: number | null; time: number } | null>(
    null
  );
  const lastHeartbeatRef = useRef<number>(0);

  // Initialize user ID and car color from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;

    let storedId = localStorage.getItem("teslanav-user-id");
    if (!storedId) {
      storedId = generateUserId();
      localStorage.setItem("teslanav-user-id", storedId);
    }
    setUserId(storedId);

    let storedColor = localStorage.getItem("teslanav-car-color") as CarColor | null;
    if (!storedColor || !CAR_COLORS.includes(storedColor)) {
      storedColor = getRandomCarColor();
      localStorage.setItem("teslanav-car-color", storedColor);
    }
    setCarColor(storedColor);
  }, []);

  // Queue position for delayed emission (privacy feature - 5 min delay)
  const queuePosition = useCallback(
    (force = false) => {
      if (!userId || latitude === null || longitude === null) return;

      const now = Date.now();
      const lastQueued = lastQueuedRef.current;

      // Check if we should queue
      if (!force && lastQueued) {
        // Throttle check
        if (now - lastQueued.time < CONFIG.QUEUE_THROTTLE_MS) return;

        // Check if position/heading changed significantly
        const distanceChange = getDistanceInMeters(lastQueued.lat, lastQueued.lng, latitude, longitude);
        const headingChange = getHeadingDiff(lastQueued.h, heading);

        if (
          distanceChange < CONFIG.MIN_DISTANCE_CHANGE &&
          headingChange < CONFIG.MIN_HEADING_CHANGE
        ) {
          // Check heartbeat - queue anyway if it's been too long
          if (now - lastHeartbeatRef.current < CONFIG.HEARTBEAT_INTERVAL_MS) {
            return;
          }
        }
      }

      // Add to queue for delayed emission
      positionQueueRef.current.push({
        data: {
          id: userId,
          lat: latitude,
          lng: longitude,
          h: heading,
          c: carColor,
        },
        queuedAt: now,
      });

      // Trim queue if it exceeds max size (keep most recent) - prevents memory growth in long sessions
      if (positionQueueRef.current.length > CONFIG.MAX_QUEUE_SIZE) {
        positionQueueRef.current = positionQueueRef.current.slice(-CONFIG.MAX_QUEUE_SIZE);
      }

      lastQueuedRef.current = { lat: latitude, lng: longitude, h: heading, time: now };
      lastHeartbeatRef.current = now;
    },
    [userId, latitude, longitude, heading, carColor]
  );

  // Process queue and emit positions that have waited long enough (privacy delay)
  useEffect(() => {
    const processQueue = async () => {
      const now = Date.now();
      const queue = positionQueueRef.current;
      
      // Find positions ready to emit (older than PRIVACY_DELAY_MS)
      const readyToEmit: QueuedPosition[] = [];
      const remaining: QueuedPosition[] = [];
      
      for (const item of queue) {
        if (now - item.queuedAt >= CONFIG.PRIVACY_DELAY_MS) {
          readyToEmit.push(item);
        } else {
          remaining.push(item);
        }
      }
      
      // Update queue with remaining items
      positionQueueRef.current = remaining;
      
      // Emit only the most recent position that's ready (no need to emit all historical)
      if (readyToEmit.length > 0) {
        const mostRecent = readyToEmit[readyToEmit.length - 1];
        try {
          await fetch("/api/realtime/emit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "user.position",
              data: mostRecent.data,
            }),
          });
        } catch (error) {
          console.error("Failed to emit delayed position:", error);
        }
      }
    };

    const interval = setInterval(processQueue, CONFIG.DELAY_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to realtime position updates (delayed)
  const { status } = useRealtime({
    enabled: enabled && !!userId,
    channels: ["live-map"],
    events: ["user.position"],
    onData({ data }) {
      const position = data as UserPosition;
      // Don't track ourselves
      if (position.id === userId) return;

      setOtherUsers((prev) => {
        const next = new Map(prev);
        next.set(position.id, { ...position, lastUpdate: Date.now() });
        return next;
      });
    },
  });
  
  // Subscribe to real-time presence pings (no delay, no location)
  useRealtime({
    enabled: enabled && !!userId,
    channels: ["presence"],
    events: ["user.ping"],
    onData({ data }) {
      const { id } = data as { id: string };
      // Don't track ourselves
      if (id === userId) return;

      setLiveUsers((prev) => {
        const next = new Map(prev);
        next.set(id, Date.now());
        return next;
      });
    },
  });

  // Queue position when location changes (will be emitted after privacy delay)
  useEffect(() => {
    if (!enabled || latitude === null || longitude === null) return;
    queuePosition();
  }, [latitude, longitude, heading, enabled, queuePosition]);

  // Cleanup stale users periodically (delayed positions)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setOtherUsers((prev) => {
        let hasChanges = false;
        const next = new Map(prev);

        for (const [id, user] of next) {
          if (now - user.lastUpdate > CONFIG.STALE_USER_TIMEOUT_MS) {
            next.delete(id);
            hasChanges = true;
          }
        }

        return hasChanges ? next : prev;
      });
    }, CONFIG.CLEANUP_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // Emit presence pings periodically (real-time, no location data)
  useEffect(() => {
    if (!enabled || !userId) return;

    const emitPing = async () => {
      try {
        await fetch("/api/realtime/emit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "user.ping",
            channel: "presence",
            data: { id: userId },
          }),
        });
      } catch (error) {
        console.error("Failed to emit presence ping:", error);
      }
    };

    // Emit immediately on mount
    emitPing();
    
    // Then emit periodically
    const interval = setInterval(emitPing, CONFIG.PRESENCE_PING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, userId]);

  // Cleanup stale live users (presence)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setLiveUsers((prev) => {
        let hasChanges = false;
        const next = new Map(prev);

        for (const [id, lastPing] of next) {
          if (now - lastPing > CONFIG.PRESENCE_STALE_MS) {
            next.delete(id);
            hasChanges = true;
          }
        }

        return hasChanges ? next : prev;
      });
    }, CONFIG.PRESENCE_CLEANUP_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // Convert Map to array for consumers
  const otherUsersArray = Array.from(otherUsers.values()).map(({ lastUpdate, ...user }) => user);

  return {
    otherUsers: otherUsersArray,
    userId,
    carColor,
    connectionStatus: status,
    liveCount: liveUsers.size + 1, // +1 for self (real-time presence)
    nearbyCount: otherUsersArray.length + 1, // +1 for self (delayed positions)
  };
}

