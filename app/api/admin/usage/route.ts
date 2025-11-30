import { NextRequest, NextResponse } from "next/server";
import {
  redis,
  getApiUsage,
  getDailyUsage,
  getMonthKey,
  MAPBOX_LIMITS,
  ALERT_THRESHOLDS,
  CACHE_KEYS,
  CACHE_TTL,
  hasAlertBeenSent,
  markAlertSent,
  type ApiName,
} from "@/lib/redis";

// Simple admin auth - you can make this more secure
const ADMIN_SECRET = process.env.ADMIN_SECRET || "teslanav-admin-2024";
const INBOUND_API_KEY = process.env.INBOUND_API_KEY;
const INBOUND_API_URL = "https://inbound.new/api/v2/emails";
const ALERT_EMAIL = process.env.ALERT_EMAIL || "ryan@mandarin3d.com";

interface UsageStats {
  apiName: ApiName;
  displayName: string;
  currentUsage: number;
  limit: number;
  percentUsed: number;
  dailyUsage: { date: string; count: number }[];
  status: "ok" | "warning" | "critical" | "exceeded";
  alertsTriggered: number[];
}

/**
 * GET /api/admin/usage
 * Returns usage statistics for all tracked APIs
 */
export async function GET(request: NextRequest) {
  // Check admin auth
  const authHeader = request.headers.get("authorization");
  const providedSecret = authHeader?.replace("Bearer ", "");
  
  if (providedSecret !== ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const apis: { name: ApiName; displayName: string; limit: number }[] = [
      { name: "geocoding", displayName: "Geocoding API v6", limit: MAPBOX_LIMITS.GEOCODING },
      { name: "reverse_geocoding", displayName: "Reverse Geocoding", limit: MAPBOX_LIMITS.TEMPORARY_GEOCODING },
      { name: "map_loads", displayName: "Map Loads", limit: MAPBOX_LIMITS.MAP_LOADS },
      { name: "directions", displayName: "Directions API", limit: MAPBOX_LIMITS.DIRECTIONS },
    ];

    const stats: UsageStats[] = await Promise.all(
      apis.map(async (api) => {
        const [currentUsage, dailyUsage] = await Promise.all([
          getApiUsage(api.name),
          getDailyUsage(api.name, 14), // Last 14 days
        ]);

        const percentUsed = (currentUsage / api.limit) * 100;

        // Determine status
        let status: UsageStats["status"] = "ok";
        if (percentUsed >= 100) {
          status = "exceeded";
        } else if (percentUsed >= 90) {
          status = "critical";
        } else if (percentUsed >= 75) {
          status = "warning";
        }

        // Check which thresholds have been triggered
        const alertsTriggered: number[] = [];
        for (const threshold of ALERT_THRESHOLDS) {
          if (percentUsed >= threshold && await hasAlertBeenSent(api.name, threshold)) {
            alertsTriggered.push(threshold);
          }
        }

        return {
          apiName: api.name,
          displayName: api.displayName,
          currentUsage,
          limit: api.limit,
          percentUsed: Math.round(percentUsed * 100) / 100,
          dailyUsage,
          status,
          alertsTriggered,
        };
      })
    );

    // Calculate totals
    const totalUsage = stats.reduce((sum, s) => sum + s.currentUsage, 0);
    const totalLimit = stats.reduce((sum, s) => sum + s.limit, 0);

    return NextResponse.json({
      stats,
      summary: {
        totalUsage,
        totalLimit,
        percentUsed: Math.round((totalUsage / totalLimit) * 100 * 100) / 100,
        billingPeriod: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }),
      },
    });
  } catch (error) {
    console.error("Usage stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage statistics" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/usage/alert
 * Trigger alert check and send email if thresholds crossed
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const providedSecret = authHeader?.replace("Bearer ", "");
  
  if (providedSecret !== ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { apiName } = body as { apiName?: ApiName };

    if (!apiName) {
      return NextResponse.json(
        { error: "Missing apiName" },
        { status: 400 }
      );
    }

    const currentUsage = await getApiUsage(apiName);
    const limit = MAPBOX_LIMITS[apiName.toUpperCase() as keyof typeof MAPBOX_LIMITS] || 100000;
    const percentUsed = (currentUsage / limit) * 100;

    const alertsToSend: number[] = [];

    // Check each threshold
    for (const threshold of ALERT_THRESHOLDS) {
      if (percentUsed >= threshold) {
        const alreadySent = await hasAlertBeenSent(apiName, threshold);
        if (!alreadySent) {
          alertsToSend.push(threshold);
          await markAlertSent(apiName, threshold);
        }
      }
    }

    // Send email notification if alerts need to be sent
    if (alertsToSend.length > 0) {
      await sendAlertEmail(apiName, currentUsage, limit, Math.max(...alertsToSend));
    }

    return NextResponse.json({
      apiName,
      currentUsage,
      limit,
      percentUsed,
      alertsSent: alertsToSend,
    });
  } catch (error) {
    console.error("Alert check error:", error);
    return NextResponse.json(
      { error: "Failed to check alerts" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/usage
 * Manually set API usage (for syncing with actual Mapbox dashboard)
 */
export async function PUT(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const providedSecret = authHeader?.replace("Bearer ", "");
  
  if (providedSecret !== ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { apiName, usage } = body as { apiName?: ApiName; usage?: number };

    if (!apiName || typeof usage !== "number" || usage < 0) {
      return NextResponse.json(
        { error: "Missing or invalid apiName/usage" },
        { status: 400 }
      );
    }

    const validApis: ApiName[] = ["geocoding", "reverse_geocoding", "map_loads", "directions"];
    if (!validApis.includes(apiName)) {
      return NextResponse.json(
        { error: `Invalid apiName. Valid options: ${validApis.join(", ")}` },
        { status: 400 }
      );
    }

    const monthKey = getMonthKey();
    const key = `${CACHE_KEYS.API_USAGE}${apiName}:${monthKey}`;
    
    // Set the usage value directly
    await redis.set(key, usage, { ex: CACHE_TTL.API_USAGE });

    // Check if we should send alerts for this new value
    const limit = MAPBOX_LIMITS[apiName.toUpperCase() as keyof typeof MAPBOX_LIMITS] || 100000;
    const percentUsed = (usage / limit) * 100;
    const alertsTriggered: number[] = [];

    for (const threshold of ALERT_THRESHOLDS) {
      if (percentUsed >= threshold) {
        const alreadySent = await hasAlertBeenSent(apiName, threshold);
        if (!alreadySent) {
          alertsTriggered.push(threshold);
          await markAlertSent(apiName, threshold);
        }
      }
    }

    // Send email if any new thresholds crossed
    if (alertsTriggered.length > 0) {
      await sendAlertEmail(apiName, usage, limit, Math.max(...alertsTriggered));
    }

    return NextResponse.json({
      success: true,
      apiName,
      usage,
      percentUsed: Math.round(percentUsed * 100) / 100,
      alertsTriggered,
    });
  } catch (error) {
    console.error("Set usage error:", error);
    return NextResponse.json(
      { error: "Failed to set usage" },
      { status: 500 }
    );
  }
}

async function sendAlertEmail(
  apiName: string,
  usage: number,
  limit: number,
  threshold: number
) {
  if (!INBOUND_API_KEY) {
    console.warn("INBOUND_API_KEY not configured, skipping email");
    return;
  }

  const percentUsed = Math.round((usage / limit) * 100);
  const statusEmoji = threshold >= 100 ? "🚨" : threshold >= 90 ? "⚠️" : threshold >= 75 ? "⚡" : "📊";
  const statusColor = threshold >= 100 ? "#ef4444" : threshold >= 90 ? "#f59e0b" : threshold >= 75 ? "#eab308" : "#3b82f6";
  const bgColor = threshold >= 100 ? "#fef2f2" : threshold >= 90 ? "#fffbeb" : threshold >= 75 ? "#fefce8" : "#eff6ff";

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: ${statusColor}; margin-bottom: 20px;">
        ${statusEmoji} API Usage Alert
      </h1>
      
      <div style="background: #f3f4f6; border-radius: 12px; padding: 20px; margin: 20px 0;">
        <h2 style="margin: 0 0 10px; color: #374151; font-size: 18px;">${apiName}</h2>
        <p style="margin: 0; font-size: 32px; font-weight: bold; color: #111827;">
          ${usage.toLocaleString()} / ${limit.toLocaleString()}
        </p>
        <p style="margin: 5px 0 0; color: #6b7280;">
          ${percentUsed}% of monthly limit used
        </p>
      </div>

      <div style="background: ${bgColor}; border-left: 4px solid ${statusColor}; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
        <p style="margin: 0; color: #374151;">
          <strong>Alert triggered:</strong> Usage has crossed the ${threshold}% threshold
        </p>
      </div>

      <p style="color: #6b7280; font-size: 14px;">
        View your full usage dashboard at <a href="https://teslanav.com/admin" style="color: #3b82f6;">teslanav.com/admin</a>
      </p>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">
        Sent from TeslaNav API Usage Monitor
      </p>
    </div>
  `;

  const textContent = `
${statusEmoji} API Usage Alert

${apiName}
${usage.toLocaleString()} / ${limit.toLocaleString()} (${percentUsed}% used)

Alert triggered: Usage has crossed the ${threshold}% threshold

View your dashboard: https://teslanav.com/admin
  `.trim();

  try {
    const response = await fetch(INBOUND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${INBOUND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "TeslaNav Alerts <alerts@teslanav.com>",
        to: [ALERT_EMAIL],
        subject: `${statusEmoji} TeslaNav: ${apiName} at ${percentUsed}% usage`,
        html: htmlContent,
        text: textContent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Inbound API error:", response.status, errorData);
    } else {
      const result = await response.json();
      console.log("Alert email sent:", result.id);
    }
  } catch (error) {
    console.error("Failed to send alert email:", error);
  }
}

