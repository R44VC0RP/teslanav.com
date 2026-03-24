/**
 * Tesla Fleet API Integration
 * Fetches real-time supercharger data including availability and pricing
 * Uses OAuth 2.0 with client_id and client_secret
 */

const TESLA_API_BASE = "https://api.tesla.com/api/1";
const TESLA_AUTH_URL = "https://auth.tesla.com/oauth2/v3/token";

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

interface TeslaApiOptions {
  headers?: Record<string, string>;
}

/**
 * Get access token using OAuth 2.0 client credentials
 */
async function getAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  const clientId = process.env.TESLA_CLIENT_ID;
  const clientSecret = process.env.TESLA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Tesla client credentials not configured (TESLA_CLIENT_ID, TESLA_CLIENT_SECRET)");
  }

  // Request new token
  const response = await fetch(TESLA_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "openid vehicle_location vehicle_charging",
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Tesla OAuth error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const expiresIn = data.expires_in || 3600; // Usually 3600 seconds

  // Cache the token
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000 - 60000, // Refresh 1 min before expiry
  };

  return data.access_token;
}

/**
 * Make authenticated request to Tesla API
 */
async function fetchTeslaApi(
  endpoint: string,
  options: TeslaApiOptions = {}
): Promise<any> {
  const accessToken = await getAccessToken();

  const url = `${TESLA_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
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
