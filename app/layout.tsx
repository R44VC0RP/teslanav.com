import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@/components/Analytics";
import "./globals.css";

const circular = localFont({
  variable: "--font-circular",
  display: "swap",
  fallback: ["Avenir Next", "Avenir", "Helvetica Neue", "Arial", "sans-serif"],
  src: [
    { path: "./fonts/CircularStd-Book.woff2", weight: "400", style: "normal" },
    { path: "./fonts/CircularStd-BookItalic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/CircularStd-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/CircularStd-MediumItalic.woff2", weight: "500", style: "italic" },
    { path: "./fonts/CircularStd-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/CircularStd-BoldItalic.woff2", weight: "700", style: "italic" },
    { path: "./fonts/CircularStd-Black.woff2", weight: "900", style: "normal" },
    { path: "./fonts/CircularStd-BlackItalic.woff2", weight: "900", style: "italic" },
  ],
});

const siteDescription = "Get Waze-style alerts on your Tesla! TeslaNav brings real-time police alerts, accident reports, and road hazard notifications to your Tesla's browser. Self-hosted and fully private.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || "http://localhost:3000"),
  title: {
    default: "TeslaNav - Waze Alerts for Tesla | Police & Traffic",
    template: "%s | TeslaNav",
  },
  description: siteDescription,
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TeslaNav",
  },
  formatDetection: {
    telephone: false,
  },
  category: "navigation",
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "application-name": "TeslaNav",
    "apple-mobile-web-app-title": "TeslaNav",
    "msapplication-TileColor": "#000000",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${circular.variable} antialiased overflow-hidden`}
        style={{
          margin: 0,
          padding: 0,
          width: "100vw",
          height: "100vh",
          position: "fixed",
          inset: 0,
        }}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
