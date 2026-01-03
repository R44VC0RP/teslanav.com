/**
 * GPX (GPS Exchange Format) utility functions for TeslaNav
 * Handles generation, parsing, and manipulation of GPX data
 */

import type { TrackPoint, GPXData, RecordingSession } from "@/types/gpx";

const GPX_VERSION = "1.1";
const GPX_CREATOR = "TeslaNav";
const GPX_NAMESPACE = "http://www.topografix.com/GPX/1/1";
const TESLANAV_NAMESPACE = "http://teslanav.com/gpx/extensions";

/**
 * Generate a GPX XML string from track points
 */
export function generateGPX(points: TrackPoint[], name: string): string {
  const now = new Date().toISOString();
  
  const trackPoints = points.map(point => {
    const extensions = [];
    if (point.heading !== undefined) {
      extensions.push(`        <teslanav:heading>${point.heading.toFixed(1)}</teslanav:heading>`);
    }
    if (point.speed !== undefined) {
      extensions.push(`        <teslanav:speed>${point.speed.toFixed(2)}</teslanav:speed>`);
    }
    if (point.accuracy !== undefined) {
      extensions.push(`        <teslanav:accuracy>${point.accuracy.toFixed(1)}</teslanav:accuracy>`);
    }
    
    const extensionsBlock = extensions.length > 0
      ? `\n      <extensions>\n${extensions.join('\n')}\n      </extensions>`
      : '';
    
    const elevation = point.elevation !== undefined
      ? `\n        <ele>${point.elevation.toFixed(1)}</ele>`
      : '';
    
    return `      <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lon.toFixed(7)}">${elevation}
        <time>${point.time}</time>${extensionsBlock}
      </trkpt>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="${GPX_VERSION}" creator="${GPX_CREATOR}"
  xmlns="${GPX_NAMESPACE}"
  xmlns:teslanav="${TESLANAV_NAMESPACE}">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${now}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

/**
 * Parse a GPX XML string into structured data
 */
export function parseGPX(gpxString: string): GPXData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxString, "application/xml");
  
  // Check for parsing errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid GPX file: " + parseError.textContent);
  }
  
  // Parse metadata
  const metadataEl = doc.querySelector("metadata");
  const metadata = {
    name: metadataEl?.querySelector("name")?.textContent || "Untitled",
    description: metadataEl?.querySelector("desc")?.textContent || undefined,
    time: metadataEl?.querySelector("time")?.textContent || new Date().toISOString(),
    creator: doc.documentElement.getAttribute("creator") || "Unknown",
  };
  
  // Parse tracks
  const tracks = Array.from(doc.querySelectorAll("trk")).map(trk => {
    const name = trk.querySelector("name")?.textContent || undefined;
    
    const segments = Array.from(trk.querySelectorAll("trkseg")).map(seg => {
      const points = Array.from(seg.querySelectorAll("trkpt")).map(trkpt => {
        const lat = parseFloat(trkpt.getAttribute("lat") || "0");
        const lon = parseFloat(trkpt.getAttribute("lon") || "0");
        const time = trkpt.querySelector("time")?.textContent || new Date().toISOString();
        const elevation = trkpt.querySelector("ele")?.textContent;
        
        // Parse TeslaNav extensions
        const extensions = trkpt.querySelector("extensions");
        const heading = extensions?.querySelector("heading")?.textContent;
        const speed = extensions?.querySelector("speed")?.textContent;
        const accuracy = extensions?.querySelector("accuracy")?.textContent;
        
        const point: TrackPoint = { lat, lon, time };
        if (elevation) point.elevation = parseFloat(elevation);
        if (heading) point.heading = parseFloat(heading);
        if (speed) point.speed = parseFloat(speed);
        if (accuracy) point.accuracy = parseFloat(accuracy);
        
        return point;
      });
      
      return { points };
    });
    
    return { name, segments };
  });
  
  return { metadata, tracks };
}

/**
 * Calculate bounds from track points
 */
export function calculateBounds(points: TrackPoint[]): RecordingSession["bounds"] {
  if (points.length === 0) {
    return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };
  }
  
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLon = points[0].lon;
  let maxLon = points[0].lon;
  
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }
  
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Calculate duration from track points (first to last timestamp)
 */
export function calculateDuration(points: TrackPoint[]): number {
  if (points.length < 2) return 0;
  
  const startTime = new Date(points[0].time).getTime();
  const endTime = new Date(points[points.length - 1].time).getTime();
  
  return endTime - startTime;
}

/**
 * Generate an auto-formatted name for a recording
 */
export function generateRecordingName(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  return `Recording ${now.toLocaleDateString("en-US", options)}`;
}

/**
 * Generate a unique session token for this browser/device
 * Stored in localStorage and used to filter recordings
 */
export function getOrCreateSessionToken(): string {
  const STORAGE_KEY = "teslanav-session-token";
  
  if (typeof window === "undefined") {
    return "server";
  }
  
  let token = localStorage.getItem(STORAGE_KEY);
  if (!token) {
    token = generateUUID();
    localStorage.setItem(STORAGE_KEY, token);
  }
  
  return token;
}

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Escape special characters for XML
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format duration in milliseconds to human-readable string (HH:MM:SS or MM:SS)
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Download GPX data as a file
 */
export function downloadGPX(gpxString: string, filename: string): void {
  const blob = new Blob([gpxString], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".gpx") ? filename : `${filename}.gpx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Interpolate between two track points based on time
 */
export function interpolatePosition(
  pointA: TrackPoint,
  pointB: TrackPoint,
  targetTime: number
): { lat: number; lon: number; heading: number } {
  const timeA = new Date(pointA.time).getTime();
  const timeB = new Date(pointB.time).getTime();
  
  // Calculate interpolation factor (0 = pointA, 1 = pointB)
  const t = (targetTime - timeA) / (timeB - timeA);
  const clampedT = Math.max(0, Math.min(1, t));
  
  // Linear interpolation for position
  const lat = pointA.lat + (pointB.lat - pointA.lat) * clampedT;
  const lon = pointA.lon + (pointB.lon - pointA.lon) * clampedT;
  
  // Interpolate heading (handle wraparound at 360)
  let heading = 0;
  if (pointA.heading !== undefined && pointB.heading !== undefined) {
    heading = interpolateAngle(pointA.heading, pointB.heading, clampedT);
  } else if (pointB.heading !== undefined) {
    heading = pointB.heading;
  } else if (pointA.heading !== undefined) {
    heading = pointA.heading;
  } else {
    // Calculate heading from movement direction
    heading = calculateBearing(pointA.lat, pointA.lon, pointB.lat, pointB.lon);
  }
  
  return { lat, lon, heading };
}

/**
 * Interpolate between two angles, handling wraparound
 */
function interpolateAngle(a: number, b: number, t: number): number {
  // Normalize angles to 0-360
  a = ((a % 360) + 360) % 360;
  b = ((b % 360) + 360) % 360;
  
  // Find shortest path
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  
  return ((a + diff * t) % 360 + 360) % 360;
}

/**
 * Calculate bearing between two points in degrees (0-360, where 0 is north)
 */
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  
  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  
  const bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}
