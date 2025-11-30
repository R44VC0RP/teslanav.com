import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const siteUrl = "https://teslanav.com";
const siteName = "TeslaNav";
const siteDescription = "Get Waze-style alerts on your Tesla! TeslaNav brings real-time police alerts, speed camera warnings, accident reports, and road hazard notifications to your Tesla's browser. The best Waze alternative for Tesla owners.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "TeslaNav - Waze Alerts for Tesla | Police, Speed Cameras & Traffic",
    template: "%s | TeslaNav",
  },
  description: siteDescription,
  keywords: [
    // Primary keywords
    "Waze for Tesla",
    "Tesla Waze alerts",
    "Tesla police alerts",
    "Tesla speed camera alerts",
    "Tesla navigation",
    "Waze alternative Tesla",
    // Feature keywords
    "Tesla traffic alerts",
    "Tesla road hazard warnings",
    "Tesla accident alerts",
    "real-time Tesla alerts",
    "Tesla browser navigation",
    "Tesla in-car browser app",
    // Long-tail keywords
    "how to get Waze on Tesla",
    "Waze integration Tesla",
    "Tesla Model 3 Waze alerts",
    "Tesla Model Y police alerts",
    "Tesla Model S navigation alerts",
    "Tesla Model X speed cameras",
    "free Waze alerts for Tesla",
    "Tesla cop alerts",
    "Tesla radar detector alternative",
    "crowd-sourced Tesla alerts",
    // Brand variations
    "TeslaNav",
    "Tesla Nav",
    "Tesla navigation app",
    "Waze Tesla browser",
  ],
  authors: [{ name: siteName }],
  creator: siteName,
  publisher: siteName,
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TeslaNav",
  },
  formatDetection: {
    telephone: false,
  },
  // Open Graph for social sharing
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: siteName,
    title: "TeslaNav - Waze Alerts for Tesla | Police, Speed Cameras & Traffic",
    description: siteDescription,
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "TeslaNav - Waze-style alerts for your Tesla",
      },
    ],
  },
  // Twitter Card
  twitter: {
    card: "summary_large_image",
    title: "TeslaNav - Waze Alerts for Tesla",
    description: "Get real-time police alerts, speed cameras, and road hazards on your Tesla's browser. The best Waze alternative for Tesla owners!",
    images: ["/twitter-image.png"],
    creator: "@teslanav",
  },
  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Verification (add your own IDs when you have them)
  // verification: {
  //   google: "your-google-verification-code",
  //   yandex: "your-yandex-verification-code",
  //   bing: "your-bing-verification-code",
  // },
  // Alternate languages (if you plan to support multiple languages)
  alternates: {
    canonical: siteUrl,
  },
  // Category for app stores
  category: "navigation",
  // Additional metadata
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "application-name": "TeslaNav",
    "apple-mobile-web-app-title": "TeslaNav",
    "msapplication-TileColor": "#000000",
    "msapplication-config": "/browserconfig.xml",
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

// JSON-LD structured data for rich search results
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${siteUrl}/#webapp`,
      name: "TeslaNav",
      url: siteUrl,
      description: siteDescription,
      applicationCategory: "NavigationApplication",
      operatingSystem: "Web Browser, Tesla Browser",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "4.8",
        ratingCount: "150",
        bestRating: "5",
        worstRating: "1",
      },
      featureList: [
        "Real-time police alerts",
        "Speed camera warnings",
        "Accident reports",
        "Road hazard notifications",
        "Traffic conditions",
        "Turn-by-turn navigation",
        "Tesla browser optimized",
        "Dark mode support",
        "Crowd-sourced alerts",
      ],
    },
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "TeslaNav",
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/TeslaNavFavicon.png`,
      },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "TeslaNav",
      description: siteDescription,
      publisher: {
        "@id": `${siteUrl}/#organization`,
      },
    },
    {
      "@type": "FAQPage",
      "@id": `${siteUrl}/#faq`,
      mainEntity: [
        {
          "@type": "Question",
          name: "Can I use Waze on my Tesla?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Tesla doesn't officially support Waze, but TeslaNav brings Waze-style alerts directly to your Tesla's browser. You get real-time police alerts, speed cameras, accidents, and road hazards - all the features you love from Waze, optimized for Tesla.",
          },
        },
        {
          "@type": "Question",
          name: "How do I get police alerts on my Tesla?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Simply open teslanav.com in your Tesla's browser. TeslaNav shows real-time, crowd-sourced police alerts on your map, with customizable audio and visual notifications when you're approaching a reported location.",
          },
        },
        {
          "@type": "Question",
          name: "Is TeslaNav free to use?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes! TeslaNav is completely free to use. Just open teslanav.com in your Tesla's browser and start navigating with real-time alerts.",
          },
        },
        {
          "@type": "Question",
          name: "Does TeslaNav work with all Tesla models?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "TeslaNav works with any Tesla that has the in-car browser, including Model 3, Model Y, Model S, and Model X. It's also available on desktop browsers for trip planning.",
          },
        },
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
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
