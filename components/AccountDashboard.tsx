"use client";

import { useCallback, useEffect, useState } from "react";
import type { SubscriptionStatus, TeslaVehicle } from "@/types/tesla";

interface AccountSummary {
  email: string | null;
  vehicles: TeslaVehicle[];
  selectedVin: string | null;
  subscriptionStatus: SubscriptionStatus;
  hasPaidAccess: boolean;
  telemetryConfiguredAt: string | null;
}

export function AccountDashboard() {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/account", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) {
          const data = (await response.json()) as { account: AccountSummary };
          setAccount(data.account);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const openBilling = useCallback(async () => {
    const response = await fetch("/api/billing/portal", { method: "POST" });
    const data = (await response.json()) as { url?: string };
    if (data.url) window.location.assign(data.url);
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    window.location.assign("/");
  }, []);

  return (
    <main className="min-h-dvh overflow-y-auto bg-gray-100 px-4 py-8 text-gray-950">
      <section className="mx-auto w-full max-w-2xl rounded-3xl bg-white p-7 shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-red-600">TeslaNav</p>
        <h1 className="mt-2 text-3xl font-semibold">Account</h1>
        {loading && <p className="mt-6 text-gray-500">Loading account…</p>}
        {!loading && !account && (
          <p className="mt-6 text-gray-600">Scan the QR code in your Tesla to sign in.</p>
        )}
        {account && (
          <div className="mt-7 space-y-5">
            <div className="rounded-2xl border border-gray-200 p-5">
              <p className="text-sm text-gray-500">Tesla account</p>
              <p className="mt-1 font-semibold">{account.email ?? "Connected Tesla account"}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 p-5">
              <p className="text-sm text-gray-500">Vehicle</p>
              <p className="mt-1 font-semibold">
                {account.vehicles.find((vehicle) => vehicle.vin === account.selectedVin)?.displayName ??
                  "No vehicle selected"}
              </p>
              {account.selectedVin && (
                <p className="mt-1 text-sm text-gray-500">VIN ending {account.selectedVin.slice(-6)}</p>
              )}
            </div>
            <div className="rounded-2xl border border-gray-200 p-5">
              <p className="text-sm text-gray-500">Subscription</p>
              <p className="mt-1 font-semibold capitalize">{account.subscriptionStatus.replace("_", " ")}</p>
              <p className="mt-1 text-sm text-gray-500">
                {account.telemetryConfiguredAt ? "Route sharing configured" : "Vehicle setup incomplete"}
              </p>
            </div>
            <button type="button" onClick={() => void openBilling()} className="min-h-12 w-full rounded-xl bg-gray-950 px-5 py-3 font-semibold text-white">
              Manage subscription
            </button>
            <button type="button" onClick={() => void signOut()} className="min-h-12 w-full rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold">
              Sign out on this phone
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
