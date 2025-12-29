"use client";

import { useEffect } from "react";

// Register service worker for map tile caching
function useServiceWorker() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("[TeslaNav] Service Worker registered for tile caching");
          
          // Check for updates periodically
          setInterval(() => {
            registration.update();
          }, 60 * 60 * 1000); // Check every hour
        })
        .catch((error) => {
          console.log("[TeslaNav] Service Worker registration failed:", error);
        });
    }
  }, []);
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Register service worker for tile caching
  useServiceWorker();
  
  return <>{children}</>;
}
