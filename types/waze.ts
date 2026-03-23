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
  provider?: string; // "waze" | "openweb_ninja"
}

export interface WazeResponse {
  alerts: WazeAlert[];
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom?: number;
}

