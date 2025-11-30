import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tesla Nav",
  description: "Navigation with Waze alerts for Tesla",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tesla Nav",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        <Script
          data-website-id="dfid_RO5g2rWwS6cGfyTS7wGGW"
          data-domain="teslanav.com"
          src="/js/script.js"
          strategy="afterInteractive"
        />
      </head>
      <body
        className={`${geistSans.variable} antialiased overflow-hidden`}
        style={{
          margin: 0,
          padding: 0,
          width: "100vw",
          height: "100vh",
          position: "fixed",
          inset: 0,
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
