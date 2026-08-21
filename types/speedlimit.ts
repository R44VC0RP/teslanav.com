export type SpeedUnit = "mph" | "km/h";

export interface SpeedLimitValue {
  value: number;
  unit: SpeedUnit;
}

export interface SpeedLimitRoad {
  id: string;
  coordinates: [number, number][];
  speedLimit: SpeedLimitValue;
  forwardSpeedLimit?: SpeedLimitValue;
  backwardSpeedLimit?: SpeedLimitValue;
}
