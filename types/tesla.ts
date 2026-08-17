export interface TeslaVehicle {
  vin: string;
  displayName: string;
  state?: string;
}

export interface TeslaAccount {
  id: string;
  teslaUserId: string;
  email: string | null;
  region: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  vehicles: TeslaVehicle[];
  selectedVin: string | null;
  telemetryConfiguredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceSession {
  id: string;
  accountId: string;
  selectedVin: string;
  createdAt: string;
  expiresAt: string;
}

export type LinkSessionStatus =
  | "pending"
  | "authorized"
  | "subscribed"
  | "paired"
  | "complete"
  | "expired";

export interface LinkSession {
  id: string;
  phoneTokenHash: string;
  carTokenHash: string;
  confirmationCode: string;
  status: LinkSessionStatus;
  accountId: string | null;
  selectedVin: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface TeslaRoute {
  vin: string;
  coordinates: [number, number][];
  destinationName: string | null;
  destination: { latitude: number; longitude: number } | null;
  milesToArrival: number | null;
  minutesToArrival: number | null;
  trafficMinutesDelay: number | null;
  updatedAt: string;
}
