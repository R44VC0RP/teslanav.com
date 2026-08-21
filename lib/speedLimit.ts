import type { SpeedLimitRoad, SpeedLimitValue } from "@/types/speedlimit";

const METERS_PER_DEGREE_LATITUDE = 111_320;

function angleDifference(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360;
  return difference > 180 ? 360 - difference : difference;
}

function segmentBearing(
  start: [number, number],
  end: [number, number]
): number {
  const [startLng, startLat] = start;
  const [endLng, endLat] = end;
  const startLatRadians = startLat * Math.PI / 180;
  const endLatRadians = endLat * Math.PI / 180;
  const longitudeDelta = (endLng - startLng) * Math.PI / 180;
  const y = Math.sin(longitudeDelta) * Math.cos(endLatRadians);
  const x =
    Math.cos(startLatRadians) * Math.sin(endLatRadians) -
    Math.sin(startLatRadians) * Math.cos(endLatRadians) * Math.cos(longitudeDelta);

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function distanceToSegment(
  latitude: number,
  longitude: number,
  start: [number, number],
  end: [number, number]
): number {
  const longitudeScale = METERS_PER_DEGREE_LATITUDE * Math.cos(latitude * Math.PI / 180);
  const startX = (start[0] - longitude) * longitudeScale;
  const startY = (start[1] - latitude) * METERS_PER_DEGREE_LATITUDE;
  const endX = (end[0] - longitude) * longitudeScale;
  const endY = (end[1] - latitude) * METERS_PER_DEGREE_LATITUDE;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared === 0) {
    return Math.hypot(startX, startY);
  }

  const projection = Math.max(
    0,
    Math.min(1, -(startX * segmentX + startY * segmentY) / segmentLengthSquared)
  );
  return Math.hypot(startX + projection * segmentX, startY + projection * segmentY);
}

export function findNearestSpeedLimit(
  roads: SpeedLimitRoad[],
  latitude: number,
  longitude: number,
  heading: number | null,
  accuracy: number | null
): SpeedLimitValue | null {
  const maximumDistance = Math.max(35, Math.min((accuracy ?? 20) * 1.5, 100));
  let bestMatch: {
    distance: number;
    speedLimit: SpeedLimitValue;
  } | null = null;

  for (const road of roads) {
    for (let index = 0; index < road.coordinates.length - 1; index += 1) {
      const start = road.coordinates[index];
      const end = road.coordinates[index + 1];
      const distance = distanceToSegment(latitude, longitude, start, end);

      if (distance > maximumDistance || (bestMatch && distance >= bestMatch.distance)) {
        continue;
      }

      let speedLimit = road.speedLimit;
      if (heading !== null) {
        const bearing = segmentBearing(start, end);
        const travellingForward = angleDifference(heading, bearing) <= 90;
        speedLimit = travellingForward
          ? road.forwardSpeedLimit ?? road.speedLimit
          : road.backwardSpeedLimit ?? road.speedLimit;
      }

      bestMatch = { distance, speedLimit };
    }
  }

  return bestMatch?.speedLimit ?? null;
}
