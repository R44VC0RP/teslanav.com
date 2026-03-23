/**
 * OpenWeb Ninja Waze API utilities
 * Handles transformation between teslanav bounds format and OpenWeb Ninja API format
 */

import type { WazeAlert } from "@/types/waze";

export interface OpenWebNinjaAlert {
  id: string;
  type: string;
  subtype?: string;
  location: {
    lat: number;
    lng: number;
  };
  street?: string;
  city?: string;
  country?: string;
  description?: string;
  reliability?: number;
  confidence?: number;
  pub_millis?: number;
  report_by?: string;
}

export interface OpenWebNinjaJam {
  id: string;
  location: {
    lat: number;
    lng: number;
  };
  severity: "low" | "medium" | "high" | "severe";
  length?: number;
  delay?: number;
  speed?: number;
  blocking_alert?: string;
}

export interface OpenWebNinjaResponse {
  data: {
    parameters: Record<string, unknown>;
    request_id: string;
    status: string;
    alerts?: OpenWebNinjaAlert[];
    jams?: OpenWebNinjaJam[];
  };
}

/**
 * Convert teslanav bounds format to OpenWeb Ninja bounds format
 * Input: { left, right, bottom, top } (lon, lon, lat, lat)
 * Output: { bottom_left, top_right } where each is [lat, lng]
 */
export function convertBoundsToOpenWebNinja(bounds: {
  left: number;
  right: number;
  bottom: number;
  top: number;
}): {
  bottom_left: string;
  top_right: string;
} {
  return {
    bottom_left: `${bounds.bottom},${bounds.left}`, // [lat, lng]
    top_right: `${bounds.top},${bounds.right}`, // [lat, lng]
  };
}

/**
 * Map OpenWeb Ninja alert to WazeAlert format
 */
export function mapOpenWebNinjaAlertToWaze(
  alert: OpenWebNinjaAlert
): WazeAlert {
  // Map alert type to WazeAlert type
  const typeMap: Record<string, WazeAlert["type"]> = {
    POLICE: "POLICE",
    ACCIDENT: "ACCIDENT",
    HAZARD: "HAZARD",
    ROAD_CLOSED: "ROAD_CLOSED",
    JAM: "JAM",
    TRAFFIC_LIGHT_FAULT: "HAZARD",
    ROAD_WORK: "HAZARD",
    POLICE_SPEED_CAM: "POLICE",
  };

  const type = (typeMap[alert.type] || "HAZARD") as WazeAlert["type"];

  return {
    uuid: alert.id,
    type,
    subtype: alert.subtype,
    street: alert.street,
    city: alert.city,
    country: alert.country,
    location: {
      x: alert.location.lng, // longitude
      y: alert.location.lat, // latitude
    },
    reportDescription: alert.description,
    reliability: alert.reliability || alert.confidence || 0,
    pubMillis: alert.pub_millis || Date.now(),
    reportBy: alert.report_by,
    provider: "openweb_ninja",
  };
}

/**
 * Map OpenWeb Ninja jam to WazeAlert format (as a special JAM type alert)
 */
export function mapOpenWebNinjaJamToWaze(jam: OpenWebNinjaJam): WazeAlert {
  // Map severity to reliability (0-100 scale)
  const severityMap: Record<string, number> = {
    low: 25,
    medium: 50,
    high: 75,
    severe: 100,
  };

  return {
    uuid: `jam_${jam.id}`,
    type: "JAM",
    location: {
      x: jam.location.lng, // longitude
      y: jam.location.lat, // latitude
    },
    reliability: severityMap[jam.severity] || 50,
    reportDescription: `Traffic jam - ${jam.severity} severity${jam.length ? ` (${jam.length}m)` : ""}`,
    pubMillis: Date.now(),
    provider: "openweb_ninja",
  };
}

/**
 * Map OpenWeb Ninja response to WazeResponse format
 */
export function mapOpenWebNinjaResponse(
  response: OpenWebNinjaResponse,
  includeJams: boolean = false
): { alerts: WazeAlert[] } {
  const alerts: WazeAlert[] = [];

  // Map alerts
  if (response.data.alerts && Array.isArray(response.data.alerts)) {
    for (const alert of response.data.alerts) {
      alerts.push(mapOpenWebNinjaAlertToWaze(alert));
    }
  }

  // Map jams if requested
  if (includeJams && response.data.jams && Array.isArray(response.data.jams)) {
    for (const jam of response.data.jams) {
      alerts.push(mapOpenWebNinjaJamToWaze(jam));
    }
  }

  return { alerts };
}
