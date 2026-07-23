const timeZone = process.env.ANALYTICS_DIGEST_TIMEZONE || "America/New_York";
const sendHour = Number(process.env.ANALYTICS_DIGEST_HOUR || 9);
const port = process.env.PORT || "3000";
const apiKey = process.env.ADMIN_API_KEY;
let lastCompletedDay = "";
let running = false;

function localClock() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    day: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

async function tick() {
  const clock = localClock();
  if (running || clock.hour < sendHour || clock.day === lastCompletedDay) return;
  running = true;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/daily-digest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    lastCompletedDay = clock.day;
    console.log(`[AnalyticsDigest] Daily run complete for ${clock.day}: ${body}`);
  } catch (error) {
    console.error("[AnalyticsDigest] Scheduler attempt failed:", error);
  } finally {
    running = false;
  }
}

console.log(`[AnalyticsDigest] Scheduler ready for ${sendHour}:00 ${timeZone}`);
setTimeout(tick, 10_000);
setInterval(tick, 60_000);
