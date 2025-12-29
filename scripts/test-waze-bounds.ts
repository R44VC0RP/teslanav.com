/**
 * Test script to find Waze API bounds limits
 * 
 * This script progressively doubles the viewport size to see:
 * 1. If there's an upper limit on bounds size
 * 2. How many alerts are returned at each size
 * 3. If larger requests are rate-limited differently
 * 
 * Run with: bun run scripts/test-waze-bounds.ts
 */

// Starting viewport (San Francisco area)
const BASE_BOUNDS = {
  north: 37.79172304722957,
  south: 37.758073123862715,
  east: -122.39751317443859,
  west: -122.44128682556176,
};

// Calculate the size of a bounding box in miles
function getBoundsSize(bounds: typeof BASE_BOUNDS): { widthMiles: number; heightMiles: number; areaSqMiles: number } {
  const latMiles = Math.abs(bounds.north - bounds.south) * 69; // ~69 miles per degree latitude
  const avgLat = (bounds.north + bounds.south) / 2;
  const lngMiles = Math.abs(bounds.east - bounds.west) * 69 * Math.cos(avgLat * Math.PI / 180);
  
  return {
    widthMiles: lngMiles,
    heightMiles: latMiles,
    areaSqMiles: lngMiles * latMiles,
  };
}

// Expand bounds by a multiplier (from center)
function expandBounds(bounds: typeof BASE_BOUNDS, multiplier: number): typeof BASE_BOUNDS {
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  const halfHeight = (bounds.north - bounds.south) / 2;
  const halfWidth = (bounds.east - bounds.west) / 2;
  
  return {
    north: centerLat + halfHeight * multiplier,
    south: centerLat - halfHeight * multiplier,
    east: centerLng + halfWidth * multiplier,
    west: centerLng - halfWidth * multiplier,
  };
}

// Fetch alerts from Waze API
async function fetchWazeAlerts(bounds: typeof BASE_BOUNDS): Promise<{
  success: boolean;
  alertCount: number;
  error?: string;
  responseTime: number;
  rawResponse?: any;
}> {
  const { north, south, east, west } = bounds;
  
  // Auto-detect region based on longitude (same logic as route.ts)
  const centerLon = (east + west) / 2;
  const env = centerLon >= -170 && centerLon <= -30 ? "na" : "row";
  
  // Waze API URL (same as used in the app)
  const url = `https://www.waze.com/live-map/api/georss?top=${north}&bottom=${south}&left=${west}&right=${east}&env=${env}&types=alerts`;
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.waze.com/live-map",
      },
    });
    
    const responseTime = Date.now() - startTime;
    
    if (!response.ok) {
      return {
        success: false,
        alertCount: 0,
        error: `HTTP ${response.status}: ${response.statusText}`,
        responseTime,
      };
    }
    
    const data = await response.json();
    const alerts = data.alerts || [];
    
    return {
      success: true,
      alertCount: alerts.length,
      responseTime,
      rawResponse: {
        hasAlerts: !!data.alerts,
        hasJams: !!data.jams,
        alertTypes: alerts.reduce((acc: Record<string, number>, alert: any) => {
          acc[alert.type] = (acc[alert.type] || 0) + 1;
          return acc;
        }, {}),
      },
    };
  } catch (error) {
    return {
      success: false,
      alertCount: 0,
      error: error instanceof Error ? error.message : String(error),
      responseTime: Date.now() - startTime,
    };
  }
}

// Main test runner
async function runTests() {
  console.log("=".repeat(80));
  console.log("WAZE API BOUNDS LIMIT TEST");
  console.log("=".repeat(80));
  console.log();
  
  const baseSize = getBoundsSize(BASE_BOUNDS);
  console.log("Base viewport:");
  console.log(`  Width: ${baseSize.widthMiles.toFixed(2)} miles`);
  console.log(`  Height: ${baseSize.heightMiles.toFixed(2)} miles`);
  console.log(`  Area: ${baseSize.areaSqMiles.toFixed(2)} sq miles`);
  console.log();
  
  // Test multipliers: 1x, 2x, 4x, 8x, 16x, 32x, 64x, 128x
  const multipliers = [1, 2, 4, 8, 16, 32, 64, 128];
  
  const results: Array<{
    multiplier: number;
    bounds: typeof BASE_BOUNDS;
    size: ReturnType<typeof getBoundsSize>;
    result: Awaited<ReturnType<typeof fetchWazeAlerts>>;
  }> = [];
  
  for (const multiplier of multipliers) {
    const bounds = expandBounds(BASE_BOUNDS, multiplier);
    const size = getBoundsSize(bounds);
    
    console.log(`\nTesting ${multiplier}x (${size.areaSqMiles.toFixed(1)} sq miles)...`);
    
    // Add delay between requests to avoid rate limiting
    if (multiplier > 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const result = await fetchWazeAlerts(bounds);
    
    results.push({ multiplier, bounds, size, result });
    
    if (result.success) {
      console.log(`  ✓ ${result.alertCount} alerts in ${result.responseTime}ms`);
      if (result.rawResponse?.alertTypes) {
        const types = Object.entries(result.rawResponse.alertTypes)
          .map(([type, count]) => `${type}: ${count}`)
          .join(", ");
        console.log(`    Types: ${types}`);
      }
    } else {
      console.log(`  ✗ FAILED: ${result.error} (${result.responseTime}ms)`);
    }
  }
  
  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log();
  
  console.log("| Multiplier | Area (sq mi) | Alerts | Response Time | Status |");
  console.log("|------------|--------------|--------|---------------|--------|");
  
  for (const { multiplier, size, result } of results) {
    const status = result.success ? "OK" : "FAIL";
    const alerts = result.success ? result.alertCount.toString() : "-";
    console.log(
      `| ${multiplier.toString().padStart(10)} | ${size.areaSqMiles.toFixed(1).padStart(12)} | ${alerts.padStart(6)} | ${(result.responseTime + "ms").padStart(13)} | ${status.padStart(6)} |`
    );
  }
  
  // Analysis
  console.log("\n" + "=".repeat(80));
  console.log("ANALYSIS");
  console.log("=".repeat(80));
  
  const successfulResults = results.filter(r => r.result.success);
  
  if (successfulResults.length > 0) {
    // Check if alert count plateaus (indicating a limit)
    const alertCounts = successfulResults.map(r => r.result.alertCount);
    const maxAlerts = Math.max(...alertCounts);
    const plateauStart = successfulResults.find(r => r.result.alertCount === maxAlerts);
    
    console.log(`\nMax alerts returned: ${maxAlerts}`);
    
    // Check for diminishing returns
    let lastCount = 0;
    let diminishingAt = null;
    for (const r of successfulResults) {
      if (r.result.alertCount <= lastCount && r.multiplier > 1) {
        diminishingAt = r.multiplier;
        break;
      }
      lastCount = r.result.alertCount;
    }
    
    if (diminishingAt) {
      console.log(`\nDiminishing returns start at: ${diminishingAt}x multiplier`);
    }
    
    // Find optimal size (best alerts per sq mile ratio while still getting good coverage)
    const withRatio = successfulResults.map(r => ({
      ...r,
      alertsPerSqMile: r.result.alertCount / r.size.areaSqMiles,
    }));
    
    console.log("\nAlerts per sq mile at each level:");
    for (const r of withRatio) {
      console.log(`  ${r.multiplier}x: ${r.alertsPerSqMile.toFixed(2)} alerts/sq mi (${r.result.alertCount} total)`);
    }
    
    // Recommendation
    console.log("\n" + "-".repeat(40));
    console.log("RECOMMENDATION:");
    
    // Find the sweet spot - where we get good coverage without too much waste
    const goodOptions = successfulResults.filter(r => 
      r.size.areaSqMiles >= 1 && r.size.areaSqMiles <= 100
    );
    
    if (goodOptions.length > 0) {
      const best = goodOptions.reduce((a, b) => 
        a.result.alertCount >= b.result.alertCount * 0.9 && a.size.areaSqMiles < b.size.areaSqMiles ? a : b
      );
      console.log(`  Use ${best.multiplier}x multiplier (${best.size.areaSqMiles.toFixed(1)} sq miles)`);
      console.log(`  This gives ${best.result.alertCount} alerts with reasonable coverage`);
    }
  }
  
  // Check for failures
  const failures = results.filter(r => !r.result.success);
  if (failures.length > 0) {
    console.log("\nFailed requests:");
    for (const f of failures) {
      console.log(`  ${f.multiplier}x: ${f.result.error}`);
    }
  }
}

// Run the tests
runTests().catch(console.error);
