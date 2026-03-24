/**
 * Tesla Fleet API Integration
 * Fetches real-time supercharger data including availability and pricing
 */

const TESLA_API_BASE = "https://api.tesla.com/api/1";

interface TeslaApiOptions {
  headers?: Record<string, string>;
}

/**
 * Make authenticated request to Tesla API
 */
async function fetchTeslaApi(
  endpoint: string,
  options: TeslaApiOptions = {}
): Promise<any> {
  const apiKey = process.env.TESLA_FLEET_API_KEY;
  if (!apiKey) {
    throw new Error("Tesla API key not configured");
  }

  const url = `${TESLA_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    next: { revalidate: 300 }, // Cache for 5 minutes
  });

  if (!response.ok) {
    throw new Error(`Tesla API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get all superchargers
 */
export async function getSuperchargers(): Promise<any> {
  try {
    return await fetchTeslaApi("/superchargers");
  } catch (error) {
    console.error("Error fetching superchargers:", error);
    throw error;
  }
}

/**
 * Get supercharger details by ID
 */
export async function getSuperchargerById(id: string): Promise<any> {
  try {
    return await fetchTeslaApi(`/superchargers/${id}`);
  } catch (error) {
    console.error("Error fetching supercharger:", error);
    throw error;
  }
}

/**
 * Get real-time availability for a supercharger
 */
export async function getSuperchargerAvailability(id: string): Promise<any> {
  try {
    return await fetchTeslaApi(`/superchargers/${id}/availability`);
  } catch (error) {
    console.error("Error fetching availability:", error);
    throw error;
  }
}

/**
 * Get pricing for a supercharger
 */
export async function getSuperchargerPricing(id: string): Promise<any> {
  try {
    return await fetchTeslaApi(`/superchargers/${id}/pricing`);
  } catch (error) {
    console.error("Error fetching pricing:", error);
    throw error;
  }
}

/**
 * Get nearby superchargers by coordinates
 */
export async function getNearbySuperchargers(
  latitude: number,
  longitude: number,
  radiusKm: number = 50
): Promise<any> {
  try {
    return await fetchTeslaApi("/superchargers/nearby", {
      headers: {
        "X-Latitude": latitude.toString(),
        "X-Longitude": longitude.toString(),
        "X-Radius-KM": radiusKm.toString(),
      },
    });
  } catch (error) {
    console.error("Error fetching nearby superchargers:", error);
    throw error;
  }
}

/**
 * Get superchargers in bounding box
 */
export async function getSuperchargersByBounds(
  minLatitude: number,
  minLongitude: number,
  maxLatitude: number,
  maxLongitude: number
): Promise<any> {
  try {
    return await fetchTeslaApi("/superchargers/bounds", {
      headers: {
        "X-Min-Lat": minLatitude.toString(),
        "X-Min-Lng": minLongitude.toString(),
        "X-Max-Lat": maxLatitude.toString(),
        "X-Max-Lng": maxLongitude.toString(),
      },
    });
  } catch (error) {
    console.error("Error fetching superchargers in bounds:", error);
    throw error;
  }
}
