export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    bearing_after?: number;
  };
}

export interface RouteData {
  id: string;
  geometry: {
    coordinates: [number, number][];
    type: string;
  };
  distance: number; // meters
  duration: number; // seconds
  steps: RouteStep[];
  summary: string; // e.g., "via I-95 N"
}

export interface RoutesResponse {
  routes: RouteData[];
  selectedIndex: number;
}

