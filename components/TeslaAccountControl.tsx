"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

interface LinkDetails {
  id: string;
  carToken: string;
  confirmationCode: string;
  expiresAt: string;
  qrCode: string;
}

interface TeslaAccountControlProps {
  isDarkMode: boolean;
}

export function TeslaAccountControl({ isDarkMode }: TeslaAccountControlProps) {
  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState(false);
  const [link, setLink] = useState<LinkDetails | null>(null);
  const [status, setStatus] = useState("pending");
  const [error, setError] = useState<string | null>(null);
  const [connectionOffline, setConnectionOffline] = useState(false);
  const [isTeslaBrowser] = useState(() => {
    if (typeof navigator === "undefined") return false;
    const userAgent = navigator.userAgent.toLowerCase();
    return userAgent.includes("tesla") || userAgent.includes("qtcarbrowser");
  });

  const beginLinking = useCallback(async () => {
    setError(null);
    setOpen(true);
    try {
      const response = await fetch("/api/device/link", { method: "POST" });
      const data = (await response.json()) as
        | ({ linked: true; selectedVin: string })
        | ({ linked: false } & LinkDetails)
        | { error: string };
      if ("error" in data) {
        setError(data.error);
        return;
      }
      if (data.linked) {
        setLinked(true);
        setStatus("complete");
        return;
      }
      setLink(data);
      setStatus("pending");
    } catch {
      setConnectionOffline(true);
      setError("TeslaNav is offline. Reconnect to the internet and try again.");
    }
  }, []);

  const checkExisting = useCallback(async () => {
    try {
      const response = await fetch("/api/tesla/route", { cache: "no-store" });
      setConnectionOffline(response.status >= 500);
      if (response.status === 401) {
        setLinked(false);
        if (isTeslaBrowser) await beginLinking();
      } else if (response.ok || response.status === 402) {
        setLinked(true);
      }
    } catch {
      setConnectionOffline(true);
    }
  }, [beginLinking, isTeslaBrowser]);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkExisting(), 0);
    return () => window.clearTimeout(timer);
  }, [checkExisting]);

  useEffect(() => {
    if (!link || status === "complete") return;
    const poll = async () => {
      const response = await fetch(
        `/api/device/link/${encodeURIComponent(link.id)}?token=${encodeURIComponent(link.carToken)}`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        setStatus("expired");
        return;
      }
      const data = (await response.json()) as { status: string };
      setStatus(data.status);
      if (data.status === "complete") {
        setLinked(true);
        window.setTimeout(() => window.location.reload(), 1200);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => window.clearInterval(timer);
  }, [link, status]);

  return (
    <>
      <button
        type="button"
        onClick={() => void beginLinking()}
        className={`min-h-12 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg backdrop-blur-xl active:scale-95 ${
          linked
            ? "border-green-400/30 bg-green-600/80 text-white"
            : isDarkMode
              ? "border-white/10 bg-[#1a1a1a]/70 text-white"
              : "border-black/10 bg-white/70 text-black"
        }`}
      >
        {connectionOffline
          ? "Reconnecting…"
          : linked
            ? "Tesla connected"
            : "Connect Tesla"}
      </button>

      {open && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <section className="relative w-full max-w-lg rounded-3xl bg-white p-7 text-center text-gray-950 shadow-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 min-h-11 min-w-11 rounded-full bg-gray-100 px-3 text-xl"
              aria-label="Close"
            >
              ×
            </button>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-red-600">TeslaNav</p>
            <h2 className="mt-2 text-2xl font-semibold">
              {status === "complete" ? "Tesla connected" : "Scan with your phone"}
            </h2>
            {link && status !== "complete" && status !== "expired" && (
              <>
                <Image
                  src={link.qrCode}
                  alt="QR code to connect TeslaNav"
                  width={360}
                  height={360}
                  unoptimized
                  className="mx-auto mt-5 w-full max-w-[300px] rounded-2xl"
                />
                <p className="mt-4 text-sm text-gray-500">Confirm this code on your phone</p>
                <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.2em]">
                  {link.confirmationCode}
                </p>
                <p className="mt-4 text-sm text-gray-500">
                  Complete Tesla sign-in, subscription, and key pairing on your phone.
                </p>
                <p className="mt-3 text-sm font-medium text-red-600">
                  {status === "pending" ? "Waiting for phone…" : "Setup in progress…"}
                </p>
              </>
            )}
            {status === "complete" && (
              <p className="mt-6 rounded-2xl bg-green-50 p-5 text-green-800">
                This browser will stay signed in. Loading your Tesla route…
              </p>
            )}
            {status === "expired" && (
              <button type="button" onClick={() => void beginLinking()} className="mt-6 min-h-12 w-full rounded-xl bg-red-600 px-5 py-3 font-semibold text-white">
                Generate a new QR code
              </button>
            )}
            {error && <p className="mt-5 rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
          </section>
        </div>
      )}
    </>
  );
}
