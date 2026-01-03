/**
 * GPX (GPS Exchange Format) types for TeslaNav recording/playback
 */

/** A single track point with location and metadata */
export interface TrackPoint {
  lat: number;
  lon: number;
  time: string; // ISO 8601 timestamp
  heading?: number; // 0-360 degrees, where 0 is north
  speed?: number; // meters per second
  accuracy?: number; // GPS accuracy in meters
  elevation?: number; // meters above sea level (if available)
}

/** Metadata for a recording session (stored in localStorage) */
export interface RecordingSession {
  id: string; // UUID
  name: string; // Auto-generated name
  createdAt: string; // ISO timestamp
  duration: number; // Total duration in milliseconds
  pointCount: number; // Number of track points
  blobUrl: string; // Vercel Blob URL where GPX data is stored
  sessionToken: string; // Token to filter recordings by device/session
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

/** Full GPX data structure */
export interface GPXData {
  metadata: {
    name: string;
    description?: string;
    time: string; // ISO timestamp of creation
    creator: string;
  };
  tracks: GPXTrack[];
}

/** A track within a GPX file */
export interface GPXTrack {
  name?: string;
  segments: GPXTrackSegment[];
}

/** A segment of continuous track points */
export interface GPXTrackSegment {
  points: TrackPoint[];
}

/** Recording state for the useGPXRecorder hook */
export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  startTime: number | null;
  elapsedTime: number; // milliseconds
  pointCount: number;
  points: TrackPoint[];
}

/** Playback state for the useGPXPlayer hook */
export interface PlaybackState {
  isPlaying: boolean;
  isComplete: boolean;
  currentTime: number; // Current playback time in milliseconds from start
  duration: number; // Total duration in milliseconds
  currentPosition: {
    lat: number;
    lon: number;
    heading: number;
  } | null;
  progress: number; // 0-1 progress through the recording
}
