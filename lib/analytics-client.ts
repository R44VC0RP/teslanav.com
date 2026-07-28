export type AnalyticsEventName =
  | "map_mode_changed"
  | "map_style_changed"
  | "settings_opened"
  | "feedback_opened"
  | "police_alert_triggered"
  | "report_opened"
  | "report_submitted"
  | "sponsor_clicked"
  | "suggestion_sent"
  | "ad_impression"
  | "ad_click";

const VISITOR_KEY = "teslanav-analytics-visitor";
const SESSION_KEY = "teslanav-analytics-session";
const OPTOUT_KEY = "teslanav-analytics-optout";

function enabled(): boolean {
  return (
    typeof window !== "undefined" &&
    navigator.doNotTrack !== "1" &&
    localStorage.getItem(OPTOUT_KEY) !== "true"
  );
}

function getOrCreate(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  storage.setItem(key, value);
  return value;
}

function screenBucket(): string {
  const width = window.screen.width;
  if (width < 768) return "small";
  if (width < 1280) return "medium";
  if (width < 1920) return "large";
  return "xl";
}

function deviceContext() {
  const ua = navigator.userAgent.toLowerCase();
  const isTesla = ua.includes("tesla") || ua.includes("qtcarbrowser");
  const isTablet = /ipad|tablet/.test(ua);
  const isMobile = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/.test(ua);
  let referrerHost = "";
  try {
    if (document.referrer) {
      const host = new URL(document.referrer).hostname;
      if (host !== window.location.hostname) referrerHost = host;
    }
  } catch {
    // Invalid/missing referrer remains direct.
  }
  return {
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    deviceType: isTesla
      ? "tesla"
      : isTablet
        ? "tablet"
        : isMobile
          ? "mobile"
          : "desktop",
    isTesla,
    screenBucket: screenBucket(),
    referrerHost,
    mapMode:
      localStorage.getItem("teslanav-map-mode") === "satellite"
        ? "satellite"
        : "standard",
  } as const;
}

export function analyticsIdentity(): {
  visitorId: string;
  sessionId: string;
} | null {
  if (!enabled()) return null;
  return {
    visitorId: getOrCreate(localStorage, VISITOR_KEY),
    sessionId: getOrCreate(sessionStorage, SESSION_KEY),
  };
}

export function sendAnalytics(
  payload: {
    type: "session" | "pageview" | "heartbeat" | "event";
    path?: string;
    activeSeconds?: number;
    eventName?: AnalyticsEventName;
    eventValue?: string;
  },
  beacon = false
): void {
  const identity = analyticsIdentity();
  if (!identity) return;
  const body = JSON.stringify({
    ...identity,
    ...payload,
    path: payload.path ?? window.location.pathname,
    context: deviceContext(),
  });

  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/analytics",
      new Blob([body], { type: "application/json" })
    );
    return;
  }

  fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Analytics must never affect the app experience.
  });
}

export function trackAnalyticsEvent(
  eventName: AnalyticsEventName,
  eventValue = ""
): void {
  sendAnalytics({ type: "event", eventName, eventValue });
}
