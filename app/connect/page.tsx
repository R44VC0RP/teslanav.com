import { Suspense } from "react";
import type { Metadata } from "next";
import { ConnectFlow } from "@/components/ConnectFlow";

export const metadata: Metadata = {
  title: "Connect your Tesla",
  description: "Connect your Tesla account and TeslaNav browser securely.",
  robots: { index: false, follow: false },
};

export default function ConnectPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-gray-100" />}>
      <ConnectFlow />
    </Suspense>
  );
}
