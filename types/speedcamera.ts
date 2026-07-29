export type SpeedCameraType = "speed_camera" | "red_light_camera" | "average_speed_camera";

export interface SpeedCamera {
  id: string;
  type: SpeedCameraType;
  location: {
    lat: number;
    lon: number;
  };
  maxspeed?: string; // e.g., "35" or "35 mph"
  direction?: string; // e.g., "forward", "backward", "both"
  name?: string;
  ref?: string; // reference number if any
  source?: SpeedCameraSource; // dataset the point came from
}

export type SpeedCameraSource = "osm" | "chicago" | "dc";

export interface SpeedCameraResponse {
  cameras: SpeedCamera[];
  timestamp: number;
  source: string;
}

