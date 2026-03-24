export interface Supercharger {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  state: string;
  country: string;
  stallCount: number;
  stallCountV3?: number; // v3 connector count
  stallCountV2?: number; // v2 connector count
  stallCountOther?: number;
  amenities: string[]; // ["wifi", "restaurant", "lodging", "restroom", "shopping"]
  openingHours?: string;
  costPerMWh?: number;
  maxPower?: number; // in kW
  enabled: boolean;
  solarCanopy?: boolean;
  powerVault?: boolean;
}

export interface SuperchargerAvailability {
  id: string;
  availableStalls: number;
  totalStalls: number;
  queuedVehicles?: number;
  timestamp: number;
}

export interface SuperchargerPricing {
  id: string;
  pricePerKWh: number; // in dollars
  currency: string;
  timestamp: number;
}

export interface SuperchargerDetail extends Supercharger {
  availability?: SuperchargerAvailability;
  pricing?: SuperchargerPricing;
}
