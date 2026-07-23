export interface WazeAlert {
  id: string; // Unique alert ID (Waze uses "id", e.g. "alert-1767356104/60fc...")
  type: "POLICE" | "ACCIDENT" | "HAZARD" | "ROAD_CLOSED" | "JAM";
  subtype?: string;
  street?: string;
  city?: string;
  country?: string;
  location: {
    x: number; // longitude
    y: number; // latitude
  };
  reportDescription?: string;
  reliability: number;
  nThumbsUp?: number;
  pubMillis: number;
  reportBy?: string;
  provider?: string;
  magvar?: number; // Heading in degrees (available from the RT protocol)
}

export interface WazeResponse {
  alerts: WazeAlert[];
  startTime: string;
  endTime: string;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom?: number;
}
