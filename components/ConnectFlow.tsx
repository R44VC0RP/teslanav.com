"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SubscriptionStatus, TeslaVehicle } from "@/types/tesla";

interface AccountSummary {
  email: string | null;
  vehicles: TeslaVehicle[];
  selectedVin: string | null;
  subscriptionStatus: SubscriptionStatus;
  hasPaidAccess: boolean;
  telemetryConfiguredAt: string | null;
}

export function ConnectFlow() {
  const searchParams = useSearchParams();
  const linkId = searchParams.get("link");
  const phoneToken = searchParams.get("token");
  const confirmationCode = searchParams.get("code");
  const checkout = searchParams.get("checkout");
  const oauthError = searchParams.get("error");
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    const response = await fetch("/api/account", { cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as { account: AccountSummary };
      setAccount(data.account);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAccount();
    if (checkout === "success") {
      const timer = window.setInterval(() => void loadAccount(), 2000);
      const timeout = window.setTimeout(() => window.clearInterval(timer), 15000);
      return () => {
        window.clearInterval(timer);
        window.clearTimeout(timeout);
      };
    }
  }, [checkout, loadAccount]);

  useEffect(() => {
    if (!account?.hasPaidAccess) return;
    fetch("/api/tesla/pair", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { pairingUrl: string };
        setPairingUrl(data.pairingUrl);
      })
      .catch(() => undefined);
  }, [account?.hasPaidAccess]);

  const selectVehicle = useCallback(
    async (selectedVin: string) => {
      setActionLoading(true);
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedVin, linkId }),
      });
      if (response.ok) await loadAccount();
      setActionLoading(false);
    },
    [linkId, loadAccount]
  );

  const startCheckout = useCallback(async () => {
    if (!linkId) return;
    setActionLoading(true);
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkId }),
    });
    const data = (await response.json()) as {
      url?: string;
      error?: string;
      alreadySubscribed?: boolean;
    };
    if (data.url) window.location.assign(data.url);
    else if (data.alreadySubscribed) await loadAccount();
    else setMessage(data.error ?? "Checkout could not be started");
    setActionLoading(false);
  }, [linkId, loadAccount]);

  const finishPairing = useCallback(async () => {
    if (!linkId) return;
    setActionLoading(true);
    setMessage(null);
    const response = await fetch("/api/tesla/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkId }),
    });
    const data = (await response.json()) as { complete?: boolean; error?: string };
    if (data.complete) {
      setMessage("Connected. TeslaNav is ready in your car.");
      await loadAccount();
    } else {
      setMessage(data.error ?? "We could not verify the vehicle key yet.");
    }
    setActionLoading(false);
  }, [linkId, loadAccount]);

  if (!linkId) {
    return <ConnectCard title="Open TeslaNav in your car">Scan the QR code shown in the Tesla browser to connect it.</ConnectCard>;
  }

  if (loading) {
    return <ConnectCard title="Loading">Checking your TeslaNav account…</ConnectCard>;
  }

  if (!account) {
    const startUrl = `/api/auth/tesla/start?link=${encodeURIComponent(linkId)}&token=${encodeURIComponent(phoneToken ?? "")}`;
    return (
      <ConnectCard title="Connect TeslaNav">
        {confirmationCode && (
          <div className="mb-6 rounded-2xl bg-gray-100 p-5 text-center">
            <p className="text-sm text-gray-500">Confirm this code matches your car</p>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.2em] text-gray-950">
              {confirmationCode}
            </p>
          </div>
        )}
        {oauthError && <Notice>Sign-in was canceled or expired. Please try again.</Notice>}
        <p className="mb-6 text-gray-600">
          Continue on Tesla&apos;s secure sign-in page. TeslaNav never receives your Tesla password.
        </p>
        <a className="block min-h-12 rounded-xl bg-red-600 px-5 py-3 text-center font-semibold text-white active:bg-red-700" href={startUrl}>
          Continue with Tesla
        </a>
      </ConnectCard>
    );
  }

  if (!account.selectedVin || account.vehicles.length > 1) {
    return (
      <ConnectCard title="Choose your Tesla">
        <p className="mb-5 text-gray-600">Select the vehicle whose built-in route should appear in TeslaNav.</p>
        <div className="space-y-3">
          {account.vehicles.map((vehicle) => (
            <button
              key={vehicle.vin}
              type="button"
              disabled={actionLoading}
              onClick={() => void selectVehicle(vehicle.vin)}
              className={`w-full rounded-xl border p-4 text-left active:bg-gray-100 ${
                account.selectedVin === vehicle.vin
                  ? "border-red-600 bg-red-50"
                  : "border-gray-200 bg-white"
              }`}
            >
              <span className="block font-semibold">{vehicle.displayName}</span>
              <span className="block text-sm text-gray-500">VIN ending {vehicle.vin.slice(-6)}</span>
            </button>
          ))}
        </div>
        {account.selectedVin && account.vehicles.length > 1 && (
          <button type="button" onClick={() => setAccount({ ...account, vehicles: [account.vehicles.find((vehicle) => vehicle.vin === account.selectedVin)!] })} className="mt-5 min-h-12 w-full rounded-xl bg-gray-950 px-5 py-3 font-semibold text-white">
            Continue
          </button>
        )}
      </ConnectCard>
    );
  }

  if (!account.hasPaidAccess) {
    return (
      <ConnectCard title="Tesla route overlay">
        <div className="mb-6 rounded-2xl bg-gray-950 p-6 text-white">
          <p className="text-4xl font-semibold">$5<span className="text-base font-normal text-gray-400"> / month</span></p>
          <p className="mt-2 text-sm text-gray-300">Seven days free. Cancel anytime.</p>
        </div>
        <ul className="mb-6 space-y-2 text-gray-700">
          <li>• Tesla&apos;s active route on your TeslaNav map</li>
          <li>• Automatic route and ETA updates</li>
          <li>• Persistent sign-in in your car</li>
        </ul>
        {message && <Notice>{message}</Notice>}
        <button type="button" disabled={actionLoading} onClick={() => void startCheckout()} className="min-h-12 w-full rounded-xl bg-red-600 px-5 py-3 font-semibold text-white disabled:opacity-50">
          {actionLoading ? "Opening checkout…" : "Start free trial"}
        </button>
      </ConnectCard>
    );
  }

  return (
    <ConnectCard title={account.telemetryConfiguredAt ? "TeslaNav connected" : "Pair your vehicle key"}>
      <p className="mb-5 text-gray-600">
        Tesla requires one final confirmation in the Tesla app before route data can be shared.
      </p>
      {pairingUrl && (
        <a href={pairingUrl} className="block min-h-12 rounded-xl bg-red-600 px-5 py-3 text-center font-semibold text-white">
          Open Tesla app to pair
        </a>
      )}
      <button type="button" disabled={actionLoading} onClick={() => void finishPairing()} className="mt-3 min-h-12 w-full rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold text-gray-950 disabled:opacity-50">
        {actionLoading ? "Checking vehicle…" : "I paired the key"}
      </button>
      {message && <Notice>{message}</Notice>}
      <p className="mt-5 text-center text-sm text-gray-500">You can return to the car when setup completes.</p>
    </ConnectCard>
  );
}

function ConnectCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh overflow-y-auto bg-gray-100 px-4 py-8 text-gray-950">
      <section className="mx-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-red-600">TeslaNav</p>
        <h1 className="mb-5 text-2xl font-semibold">{title}</h1>
        {children}
      </section>
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="my-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{children}</p>;
}
