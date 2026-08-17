import { createClient } from "redis";

const NAVIGATION_FIELDS = new Set([
  "RouteLine",
  "DestinationName",
  "DestinationLocation",
  "MilesToArrival",
  "MinutesToArrival",
  "RouteTrafficMinutesDelay",
]);

interface DecodedSignal {
  key?: unknown;
  value?: unknown;
}

interface DecodedRecord {
  vin?: unknown;
  data?: unknown;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapSignal(value: unknown): unknown {
  const object = objectValue(value);
  if (!object) return value;
  const keys = [
    "stringValue",
    "string_value",
    "floatValue",
    "float_value",
    "doubleValue",
    "double_value",
    "int32Value",
    "int32_value",
    "intValue",
    "int_value",
    "longValue",
    "long_value",
    "locationValue",
    "location_value",
  ];
  for (const key of keys) {
    if (key in object) return object[key];
  }
  if (object.invalid === true) return null;
  return value;
}

export function normalizeTelemetryRecord(
  raw: string
): { vin: string; fields: Record<string, unknown> } | null {
  const record = JSON.parse(raw) as DecodedRecord;
  if (typeof record.vin !== "string" || !Array.isArray(record.data)) return null;
  const fields: Record<string, unknown> = {};
  for (const item of record.data as DecodedSignal[]) {
    if (typeof item.key !== "string" || !NAVIGATION_FIELDS.has(item.key)) {
      continue;
    }
    fields[item.key] = unwrapSignal(item.value);
  }
  return Object.keys(fields).length > 0 ? { vin: record.vin, fields } : null;
}

async function main(): Promise<void> {
  const redisUrl = process.env.TELEMETRY_REDIS_URL;
  const ingestUrl = process.env.TESLANAV_INGEST_URL;
  const ingestSecret = process.env.TESLA_TELEMETRY_INGEST_SECRET;
  if (!redisUrl || !ingestUrl || !ingestSecret) {
    throw new Error(
      "TELEMETRY_REDIS_URL, TESLANAV_INGEST_URL, and TESLA_TELEMETRY_INGEST_SECRET are required"
    );
  }

  const subscriber = createClient({ url: redisUrl });
  subscriber.on("error", (error) => {
    console.error("[TelemetryForwarder] Redis error:", error);
  });
  await subscriber.connect();
  await subscriber.pSubscribe("tesla_V_*", async (message) => {
    try {
      const payload = normalizeTelemetryRecord(message);
      if (!payload) return;
      const response = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ingestSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.error(
          `[TelemetryForwarder] ingest rejected (${response.status}): ${await response.text()}`
        );
      }
    } catch (error) {
      console.error("[TelemetryForwarder] message failed:", error);
    }
  });
  console.log("[TelemetryForwarder] subscribed to Tesla navigation records");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[TelemetryForwarder] fatal:", error);
    process.exit(1);
  });
}
