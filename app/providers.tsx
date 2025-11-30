"use client";

import { RealtimeProvider } from "@upstash/realtime/client";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider
      api={{ url: "/api/realtime" }}
      maxReconnectAttempts={5}
    >
      {children}
    </RealtimeProvider>
  );
}

