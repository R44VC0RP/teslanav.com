"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { sendAnalytics } from "@/lib/analytics-client";

const HEARTBEAT_MS = 30_000;

export function Analytics() {
  const pathname = usePathname();
  const excluded = pathname.startsWith("/admin");
  const sessionSent = useRef(false);
  const lastTrackedPath = useRef<string | null>(null);
  const visibleSince = useRef<number | null>(null);
  const pendingVisibleMs = useRef(0);

  useEffect(() => {
    if (excluded || sessionSent.current) return;
    sessionSent.current = true;
    sendAnalytics({ type: "session", path: pathname });
  }, [excluded, pathname]);

  useEffect(() => {
    if (excluded) return;
    if (lastTrackedPath.current === pathname) return;
    lastTrackedPath.current = pathname;
    sendAnalytics({ type: "pageview", path: pathname });
  }, [excluded, pathname]);

  useEffect(() => {
    if (excluded) return;
    const accumulate = () => {
      if (visibleSince.current === null) return;
      pendingVisibleMs.current += Date.now() - visibleSince.current;
      visibleSince.current = null;
    };
    const resume = () => {
      if (document.visibilityState === "visible" && visibleSince.current === null) {
        visibleSince.current = Date.now();
      }
    };
    const flush = (beacon = false) => {
      accumulate();
      const seconds = Math.floor(pendingVisibleMs.current / 1000);
      if (seconds > 0) {
        pendingVisibleMs.current -= seconds * 1000;
        sendAnalytics(
          { type: "heartbeat", path: window.location.pathname, activeSeconds: seconds },
          beacon
        );
      }
      resume();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") resume();
      else flush(true);
    };
    const pageHide = () => flush(true);

    resume();
    const interval = window.setInterval(() => flush(false), HEARTBEAT_MS);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pageHide);
      flush(true);
    };
  }, [excluded]);

  return null;
}
