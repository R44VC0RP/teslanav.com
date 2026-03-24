// OpenTraffic data - historical average speeds on road segments
export interface TrafficSegment {
  id: string; // Segment identifier
  latitude: number;
  longitude: number;
  averageSpeed: number; // km/h
  speedLimit?: number; // km/h
  timestamp: number; // When this data was recorded
}

// TomTom Traffic Incident
export interface TrafficIncident {
  id: string;
  type: 'ACCIDENT' | 'JAM' | 'ROAD_CLOSED' | 'CONSTRUCTION' | 'DISABLED_VEHICLE' | 'OTHER';
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'LOW'; // Critical = road closed, Major = heavy delay, Minor = moderate delay, Low = slow
  latitude: number;
  longitude: number;
  description: string;
  delay?: number; // seconds
  length?: number; // meters - length of affected road segment
  timestamp: number; // When incident was reported
  endTime?: number; // When incident is expected to end
}

// Combined traffic data response
export interface TrafficData {
  segments: TrafficSegment[];
  incidents: TrafficIncident[];
  fetchedAt: number;
}
