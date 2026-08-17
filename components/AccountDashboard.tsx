"use client";

import { useCallback, useEffect, useState } from "react";
import { useCustomer } from "autumn-js/react";
import { authClient } from "@/lib/auth-client";
import type { TeslaVehicle } from "@/types/tesla";

interface AccountSummary {
  email: string;
  name: string;
  teslaConnected: boolean;
  vehicles: TeslaVehicle[];
  selectedVin: string | null;
  hasPaidAccess: boolean;
  telemetryConfiguredAt: string | null;
}

export function AccountDashboard() {
  const session = authClient.useSession();
  const { openCustomerPortal } = useCustomer();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [carSessionCount, setCarSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session.isPending) return;
    if (!session.data) return;
    Promise.all([
      fetch("/api/account", { cache: "no-store" }),
      fetch("/api/device/sessions", { cache: "no-store" }),
    ])
      .then(async ([accountResponse, sessionsResponse]) => {
        if (accountResponse.ok) {
          const data = (await accountResponse.json()) as { account: AccountSummary };
          setAccount(data.account);
        }
        if (sessionsResponse.ok) {
          const data = (await sessionsResponse.json()) as {
            sessions: Array<{ id: string }>;
          };
          setCarSessionCount(data.sessions.length);
        }
      })
      .finally(() => setLoading(false));
  }, [session.data, session.isPending]);

  const openBilling = useCallback(async () => {
    await openCustomerPortal({ returnUrl: `${window.location.origin}/account` });
  }, [openCustomerPortal]);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    window.location.assign("/");
  }, []);

  const revokeCarSessions = useCallback(async () => {
    if (!window.confirm("Sign out every linked Tesla browser?")) return;
    const response = await fetch("/api/device/sessions", { method: "DELETE" });
    if (response.ok) setCarSessionCount(0);
  }, []);

  return (
    <main className="min-h-dvh overflow-y-auto bg-gray-100 px-4 py-8 text-gray-950">
      <section className="mx-auto w-full max-w-2xl rounded-3xl bg-white p-7 shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-red-600">TeslaNav</p>
        <h1 className="mt-2 text-3xl font-semibold">Account</h1>
        {(session.isPending || (session.data && loading)) && <p className="mt-6 text-gray-500">Loading account…</p>}
        {!session.isPending && !account && (
          <p className="mt-6 text-gray-600">
            Open TeslaNav in your car, choose <span className="font-semibold">Connect Tesla</span>,
            then scan the QR code displayed on the car&apos;s screen.
          </p>
        )}
        {account && (
          <div className="mt-7 space-y-5">
            <div className="rounded-2xl border border-gray-200 p-5">
              <p className="text-sm text-gray-500">Tesla account</p>
              <p className="mt-1 font-semibold">{account.email}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 p-5">
              <p className="text-sm text-gray-500">Linked car browsers</p>
              <p className="mt-1 font-semibold">
                {carSessionCount === 1
                  ? "1 active browser"
                  : `${carSessionCount} active browsers`}
              </p>
              {carSessionCount > 0 && (
                <button
                  type="button"
                  onClick={() => void revokeCarSessions()}
                  className="mt-3 min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700"
                >
                  Sign out all car browsers
                </button>
              )}
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
              <p className="mt-1 font-semibold">
                {account.hasPaidAccess ? "Tesla route overlay active" : "No active plan"}
              </p>
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
