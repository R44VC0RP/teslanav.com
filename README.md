# TeslaNav

A navigation web app optimized for Tesla's in-car browser. Built with Next.js 16 (App Router), React 19, TypeScript 5, and Tailwind CSS 4.

**Live at [teslanav.com](https://teslanav.com)**

> **License**: Free for personal, non-commercial use. See [LICENSE](./LICENSE) for details.

## Features

- Turn-by-turn navigation powered by Mapbox Directions API
- Real-time Waze alerts (police, accidents, hazards, road closures)
- OSM speed camera overlay
- Satellite and 3D terrain map modes
- GPS track recording and playback (GPX export)
- Offline tile caching via service worker
- Touch-optimized UI designed for Tesla's in-car Chromium browser

## Development

### Prerequisites

- [Bun](https://bun.sh) (package manager)
- A Mapbox account with a public token
- Upstash Redis database
- LocationIQ API key (geocoding)
- Vercel Blob storage token (GPX recording)

### Setup

```bash
# Clone the repository
git clone https://github.com/your-username/teslanav.com.git
cd teslanav.com

# Install dependencies
bun install

# Copy environment variables
cp .env.example .env.local
# Fill in the required values in .env.local

# Start the development server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Add `?dev=true` to the URL to enable tile bounds debug overlay and verbose logging.

### Commands

```bash
bun run dev          # Start dev server (http://localhost:3000)
bun run build        # Production build
bun run start        # Start production server
bun run lint         # Run ESLint
bunx tsc --noEmit    # Type check
```

## Environment Variables

Create a `.env.local` file with the following:

```bash
# Mapbox — map rendering + directions API
# Get your token at https://account.mapbox.com
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...

# Upstash Redis — server-side caching and rate limiting
# Create a database at https://console.upstash.com
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=...

# PostHog — analytics (optional)
# https://posthog.com
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.posthog.com

# Vercel Blob — GPX recording storage
# https://vercel.com/docs/storage/vercel-blob
BLOB_READ_WRITE_TOKEN=vercel_blob_...

# LocationIQ — geocoding/search
# Get a free key at https://locationiq.com
LOCATION_IQ_TOKEN=pk....

# TomTom — real-time traffic incidents
# Get an API key at https://developer.tomtom.com
TOMTOM_API_KEY=...

# OpenWeb Ninja — Waze alerts proxy
# Get an API key at https://openwebninja.com
OPENWEB_NINJA_API_KEY=...

# Inbound — feedback emails and admin alerts (optional)
# https://inbound.new
INBOUND_API_KEY=...

# Admin dashboard — protects /api/admin/* routes (optional)
ADMIN_SECRET=your-secret-key
```

**Required:**
- `NEXT_PUBLIC_MAPBOX_TOKEN` — map rendering and directions

**Recommended for full functionality:**
- `TOMTOM_API_KEY` — real-time traffic incidents
- `OPENWEB_NINJA_API_KEY` — Waze alerts (police, accidents, hazards)
- `LOCATION_IQ_TOKEN` — search/geocoding
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` — caching and rate limiting

**Optional:**
- `BLOB_READ_WRITE_TOKEN` — GPX recording storage
- `NEXT_PUBLIC_POSTHOG_KEY` — analytics
- `INBOUND_API_KEY` — feedback emails
- `ADMIN_SECRET` — admin dashboard protection

## Self-Hosting

### Vercel (recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/teslanav.com)

1. Click **Deploy** and connect your GitHub repository
2. Add all required environment variables in the Vercel dashboard
3. Enable **Vercel Blob** storage in the Storage tab of your project

### Docker / Node

```bash
bun run build
bun run start        # Runs on port 3000
```

Set `PORT` to override the default port. All environment variables must be available at runtime.

### Notes for self-hosters

- **Tile proxy**: Map tiles route through `/api/tiles` and are cached in Vercel Blob. If you are not on Vercel, you can skip `BLOB_READ_WRITE_TOKEN` — tiles will fall back to direct Mapbox requests without caching.
- **Rate limits**: Waze and OSM Overpass calls are rate-limited per-minute via Redis. Upstash has a free tier sufficient for personal use.
- **Admin dashboard**: Visit `/admin` with the `ADMIN_API_KEY` header (or use the UI) to monitor API usage against monthly limits.

## Architecture

```
app/api/           # Server-side API routes (Next.js Route Handlers)
  directions/      # Mapbox Directions (multi-route navigation)
  geocode/         # LocationIQ forward + reverse geocoding
  tomtom/          # TomTom traffic incidents with Redis cache
  waze/            # Waze alerts (police, accidents) with Redis cache
  speedcameras/    # OSM Overpass speed camera data with Redis cache
  tiles/           # Mapbox tile proxy with Blob cache
  recording/       # GPX file storage via Vercel Blob
  feedback/        # User feedback emails via Inbound
  admin/usage/     # API usage stats + threshold alerts

components/        # React UI components
hooks/             # Custom React hooks (data fetching, GPS, GPX)
lib/               # Shared utilities (Redis, PostHog, GPX, cn())
types/             # TypeScript interfaces
public/sw.js       # Service worker — offline tile cache
```

All external API calls go through server-side route handlers to keep API keys off the client. Results are cached in Redis (60 s – 24 h depending on data type) to minimize upstream usage.

## Contributing

Pull requests are welcome. Please run `bun run lint` and `bunx tsc --noEmit` before submitting. There is no automated test suite — validate changes manually in the browser, ideally in a Tesla browser or a Chromium-based mobile browser in touch emulation mode.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

You are free to fork, modify, and use this software for **personal, non-commercial purposes** (hobby projects, self-hosting for personal use, learning, experimentation). You may **not** use it to build a competing product, offer it as a service, or use it in any commercial context.
