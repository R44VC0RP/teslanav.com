/**
 * Waze API Rate Limit Tester - AGGRESSIVE VERSION
 * 
 * This script hammers the Waze Live Map API to find rate limits.
 * 
 * Run with: bunx tsx scripts/test-waze-rate-limits.ts
 */

interface TestResult {
  requestNumber: number;
  timestamp: string;
  status: number;
  responseTime: number;
  alertCount?: number;
  error?: string;
  headers?: Record<string, string>;
  body?: string;
}

// Multiple test bounds to avoid any caching
const TEST_BOUNDS = [
  { left: "-122.5", right: "-122.3", bottom: "37.7", top: "37.8" },     // SF
  { left: "-122.6", right: "-122.4", bottom: "37.6", top: "37.75" },    // South SF
  { left: "-118.35", right: "-118.15", bottom: "34.0", top: "34.1" },   // LA
  { left: "-73.1", right: "-73.9", bottom: "40.6", top: "40.8" },       // NYC
  { left: "-87.7", right: "-87.5", bottom: "41.8", top: "41.95" },      // Chicago
  { left: "-95.5", right: "-95.3", bottom: "29.7", top: "29.85" },      // Houston
  { left: "-112.1", right: "-111.9", bottom: "33.4", top: "33.55" },    // Phoenix
  { left: "-75.2", right: "-75.0", bottom: "39.9", top: "40.05" },      // Philadelphia
  { left: "-117.25", right: "-117.05", bottom: "32.7", top: "32.85" },  // San Diego
  { left: "-96.9", right: "-96.7", bottom: "32.7", top: "32.85" },      // Dallas
  { left: "-80.3", right: "-80.1", bottom: "25.7", top: "25.85" },      // Miami
  { left: "-84.45", right: "-84.25", bottom: "33.7", top: "33.85" },    // Atlanta
  { left: "-122.4", right: "-122.2", bottom: "47.55", top: "47.7" },    // Seattle
  { left: "-105.05", right: "-104.85", bottom: "39.65", top: "39.8" },  // Denver
  { left: "-71.15", right: "-70.95", bottom: "42.3", top: "42.45" },    // Boston
];

let totalRequests = 0;
let successCount = 0;
let rateLimitCount = 0;
let errorCount = 0;
let firstRateLimitAt: number | null = null;
let firstRateLimitResponse: { headers: Record<string, string>; body: string } | null = null;

async function makeWazeRequest(boundsIndex: number): Promise<TestResult & { rateLimited: boolean }> {
  const bounds = TEST_BOUNDS[boundsIndex % TEST_BOUNDS.length];
  
  // Add random offset to bounds to make each request unique
  const offset = (Math.random() - 0.5) * 0.1;
  
  const wazeUrl = new URL("https://www.waze.com/live-map/api/georss");
  wazeUrl.searchParams.set("left", (parseFloat(bounds.left) + offset).toFixed(4));
  wazeUrl.searchParams.set("right", (parseFloat(bounds.right) + offset).toFixed(4));
  wazeUrl.searchParams.set("bottom", (parseFloat(bounds.bottom) + offset).toFixed(4));
  wazeUrl.searchParams.set("top", (parseFloat(bounds.top) + offset).toFixed(4));
  
  const centerLon = (parseFloat(bounds.left) + parseFloat(bounds.right)) / 2;
  const env = centerLon >= -170 && centerLon <= -30 ? "na" : "row";
  wazeUrl.searchParams.set("env", env);
  wazeUrl.searchParams.set("types", "alerts");

  const startTime = Date.now();
  const reqNum = ++totalRequests;
  
  try {
    const response = await fetch(wazeUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    const responseTime = Date.now() - startTime;
    
    // Capture ALL headers
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    if (response.status === 429) {
      rateLimitCount++;
      
      // Get the response body
      const body = await response.text();
      
      // Store first rate limit response for detailed analysis
      if (firstRateLimitAt === null) {
        firstRateLimitAt = reqNum;
        firstRateLimitResponse = { headers, body };
      }
      
      return {
        requestNumber: reqNum,
        timestamp: new Date().toISOString(),
        status: response.status,
        responseTime,
        rateLimited: true,
        error: "Rate Limited",
        headers,
        body,
      };
    }

    if (!response.ok) {
      errorCount++;
      const body = await response.text();
      return {
        requestNumber: reqNum,
        timestamp: new Date().toISOString(),
        status: response.status,
        responseTime,
        rateLimited: false,
        error: `HTTP ${response.status}`,
        headers,
        body,
      };
    }

    successCount++;
    const data = await response.json();
    
    return {
      requestNumber: reqNum,
      timestamp: new Date().toISOString(),
      status: response.status,
      responseTime,
      alertCount: data.alerts?.length || 0,
      rateLimited: false,
      headers,
    };
  } catch (error) {
    errorCount++;
    return {
      requestNumber: reqNum,
      timestamp: new Date().toISOString(),
      status: 0,
      responseTime: Date.now() - startTime,
      rateLimited: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function printStatus(result: TestResult & { rateLimited: boolean }) {
  const icon = result.rateLimited ? "🚫" : result.status === 200 ? "✅" : "⚠️";
  const alerts = result.alertCount !== undefined ? ` | ${result.alertCount} alerts` : "";
  console.log(
    `${icon} #${result.requestNumber.toString().padStart(4)} | ${result.status} | ${result.responseTime.toString().padStart(4)}ms${alerts}${result.error ? ` | ${result.error}` : ""}`
  );
}

function printSummary() {
  console.log("\n" + "═".repeat(60));
  console.log("📊 CURRENT STATS");
  console.log("═".repeat(60));
  console.log(`Total requests:  ${totalRequests}`);
  console.log(`Successful:      ${successCount} (${((successCount/totalRequests)*100).toFixed(1)}%)`);
  console.log(`Rate limited:    ${rateLimitCount} (${((rateLimitCount/totalRequests)*100).toFixed(1)}%)`);
  console.log(`Errors:          ${errorCount}`);
  if (firstRateLimitAt) {
    console.log(`First rate limit at request #${firstRateLimitAt}`);
  }
  console.log("═".repeat(60));
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runMassiveBurst(totalReqs: number): Promise<void> {
  console.log(`\n💥 MASSIVE BURST: ${totalReqs} requests fired simultaneously\n`);
  
  const promises = [];
  for (let i = 0; i < totalReqs; i++) {
    promises.push(makeWazeRequest(i));
  }
  
  const results = await Promise.all(promises);
  
  // Sort by request number for cleaner output
  results.sort((a, b) => a.requestNumber - b.requestNumber);
  results.forEach(printStatus);
  
  printSummary();
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║        WAZE API RATE LIMIT TESTER - AGGRESSIVE MODE          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("\n⚠️  WARNING: This will hammer Waze's API aggressively!\n");

  // Reset counters
  totalRequests = 0;
  successCount = 0;
  rateLimitCount = 0;
  errorCount = 0;
  firstRateLimitAt = null;
  firstRateLimitResponse = null;

  // Test 1: Fire 100 requests simultaneously
  await runMassiveBurst(100);
  
  if (rateLimitCount === 0) {
    console.log("\n⏳ No rate limits yet. Waiting 10s then escalating...\n");
    await sleep(10000);
    
    // Test 2: Fire 200 more simultaneously  
    await runMassiveBurst(200);
  }

  // Print detailed rate limit response
  if (firstRateLimitResponse) {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║              RATE LIMIT RESPONSE DETAILS                      ║");
    console.log("╚══════════════════════════════════════════════════════════════╝\n");
    
    console.log("📋 RESPONSE HEADERS:");
    console.log("─".repeat(60));
    for (const [key, value] of Object.entries(firstRateLimitResponse.headers)) {
      console.log(`  ${key}: ${value}`);
    }
    
    console.log("\n📄 RESPONSE BODY:");
    console.log("─".repeat(60));
    try {
      // Try to pretty print if it's JSON
      const parsed = JSON.parse(firstRateLimitResponse.body);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      // Otherwise print raw
      console.log(firstRateLimitResponse.body || "(empty body)");
    }
  }

  // Final summary
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                      FINAL RESULTS                            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\nTotal requests made: ${totalRequests}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Rate limited: ${rateLimitCount}`);
  console.log(`Errors: ${errorCount}`);
  
  if (firstRateLimitAt) {
    console.log(`\n🎯 Rate limiting kicked in at request #${firstRateLimitAt}`);
  } else {
    console.log("\n🤯 NO RATE LIMITING DETECTED!");
  }
}

main().catch(console.error);
