import type { MapBounds } from "@/types/waze";

/**
 * Expand bounds by a multiplier (e.g., 1.5x for 50% expansion)
 * Maintains center point of original bounds
 */
export function expandBounds(
  bounds: MapBounds,
  multiplier: number
): MapBounds {
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;
  const paddingFactor = (multiplier - 1) / 2;
  const horizontalPadding = width * paddingFactor;
  const verticalPadding = height * paddingFactor;

  return {
    west: bounds.west - horizontalPadding,
    east: bounds.east + horizontalPadding,
    south: bounds.south - verticalPadding,
    north: bounds.north + verticalPadding,
    zoom: bounds.zoom,
  };
}

/**
 * Check if viewport bounds are fully contained within fetched bounds
 * Returns true if we have all data needed for current viewport
 */
export function isViewportContained(
  viewport: MapBounds,
  fetchedBounds: MapBounds
): boolean {
  return (
    viewport.west >= fetchedBounds.west &&
    viewport.east <= fetchedBounds.east &&
    viewport.south >= fetchedBounds.south &&
    viewport.north <= fetchedBounds.north
  );
}

/**
 * Check if two bounds regions overlap
 */
export function boundsOverlap(a: MapBounds, b: MapBounds): boolean {
  return !(
    a.east < b.west ||
    a.west > b.east ||
    a.north < b.south ||
    a.south > b.north
  );
}
