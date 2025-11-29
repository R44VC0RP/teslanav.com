export interface WazeAlert {
  uuid: string;
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

