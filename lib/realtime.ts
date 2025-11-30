import { Realtime, InferRealtimeEvents } from "@upstash/realtime";
import { redis } from "./redis";
import { z } from "zod";

// Minimal schema for user position updates
// We keep this lightweight to minimize Upstash costs
const schema = {
  // User position updates - minimal payload (5-min delayed for privacy)
  user: {
    // Position update: userId, lat, lng, heading, carColor
    position: z.object({
      id: z.string(), // unique user id
      lat: z.number(), // latitude
      lng: z.number(), // longitude
      h: z.number().nullable(), // heading (0-360) or null if unknown
      c: z.string(), // car color: "blue" | "green" | "pink" | "white" | "yellow" | "christmas"
    }),
    // Presence ping - just "I'm here" with no location data (real-time, no delay)
    ping: z.object({
      id: z.string(), // unique user id
    }),
  },
};

export const realtime = new Realtime({ schema, redis });
export type RealtimeEvents = InferRealtimeEvents<typeof realtime>;

// Type for a user position
export type UserPosition = z.infer<typeof schema.user.position>;

