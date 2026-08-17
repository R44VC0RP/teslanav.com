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
- Optional Tesla Fleet Telemetry route overlay with QR-based device linking

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
LOCATIONIQ_API_KEY=pk....

# Inbound — feedback emails and admin alerts (optional)
# https://inbound.new
INBOUND_API_KEY=...

# Admin dashboard — protects /api/admin/* routes
ADMIN_API_KEY=your-secret-key

# Better Auth, Autumn billing, Tesla Fleet API, and telemetry
# See .env.example for the complete production configuration.
TESLANAV_SESSION_SECRET=a-random-secret-with-at-least-32-characters
NEXT_PUBLIC_APP_URL=https://app.teslanav.com
BETTER_AUTH_SECRET=another-random-secret
BETTER_AUTH_URL=https://app.teslanav.com
TESLANAV_DATABASE_PATH=./data/teslanav.sqlite
AUTUMN_SECRET_KEY=
AUTUMN_TESLA_ROUTE_FEATURE_ID=tesla_route
NEXT_PUBLIC_AUTUMN_PLAN_ID=tesla_nav_pro
TESLA_CLIENT_ID=
TESLA_CLIENT_SECRET=
TESLA_REDIRECT_URI=https://app.teslanav.com/api/auth/tesla/callback
TESLA_PARTNER_DOMAIN=teslanav.com
TESLA_PUBLIC_KEY_PEM=
TESLA_COMMAND_PROXY_URL=
TESLA_TELEMETRY_HOSTNAME=telemetry.teslanav.com
TESLA_TELEMETRY_CA=
TESLA_TELEMETRY_INGEST_SECRET=
```

Only `NEXT_PUBLIC_MAPBOX_TOKEN` is strictly required to run the map. Other services degrade gracefully when keys are absent (search, alerts, and recording will not function).

## Self-Hosting

### Docker on exe.dev

```bash
bun run build
bun run start        # Runs on port 3000
```

Set `PORT` to override the default port. All environment variables must be available at runtime.

For a production Docker deployment on exe.dev, use
`docker-compose.exe-dev.yml` and follow
[`docs/exe-dev-deployment.md`](./docs/exe-dev-deployment.md). Tesla's mTLS
Fleet Telemetry receiver cannot run behind exe.dev's TLS-terminating edge; the
repository includes `docker-compose.telemetry.yml` for deploying that receiver
on a separate host with raw public TCP port 443. For EC2, use
`deploy/telemetry/deploy.sh` to install and deploy the complete telemetry stack
over SSH.

### Notes for self-hosters

- **Tile proxy**: Map tiles route through `/api/tiles` and are cached in Vercel Blob. If you are not on Vercel, you can skip `BLOB_READ_WRITE_TOKEN` — tiles will fall back to direct Mapbox requests without caching.
- **Rate limits**: Waze and OSM Overpass calls are rate-limited per-minute via Redis. Upstash has a free tier sufficient for personal use.
- **Admin dashboard**: Visit `/admin` with the `ADMIN_API_KEY` header (or use the UI) to monitor API usage against monthly limits.

## Architecture

```
app/api/           # Server-side API routes (Next.js Route Handlers)
  directions/      # Mapbox Directions (multi-route)
  geocode/         # LocationIQ forward + reverse geocoding
  waze/            # Waze alerts proxy with Redis cache
  speedcameras/    # OSM Overpass speed camera data
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

### Tesla account and route integration

The Tesla browser creates a ten-minute, single-use linking session and displays
a QR code. On the phone, Better Auth manages the TeslaNav account, Tesla OAuth
connects the vehicle, and Autumn manages plan checkout and access. SQLite is
stored on the persistent Docker volume. Once linked, the browser receives a
one-year, HTTP-only device session cookie; users do not enter credentials in
the vehicle.

Tesla Fleet Telemetry requires a separate public receiver that accepts the
vehicle's mTLS WebSocket connection on port 443. The receiver should normalize
navigation updates and forward them to:

```http
POST /api/telemetry/ingest
Authorization: Bearer $TESLA_TELEMETRY_INGEST_SECRET
Content-Type: application/json

{
  "vin": "VIN",
  "fields": {
    "RouteLine": "base64...",
    "DestinationName": "Destination",
    "DestinationLocation": { "latitude": 0, "longitude": 0 },
    "MilesToArrival": 12.3,
    "MinutesToArrival": 18,
    "RouteTrafficMinutesDelay": 4
  }
}
```

`RouteLine` is decoded server-side and retained for 12 hours. The car polls the
authenticated route endpoint every ten seconds. Route access is checked
server-side against the Autumn feature configured by
`AUTUMN_TESLA_ROUTE_FEATURE_ID`; TeslaNav does not process billing webhooks
directly.

## Contributing

Pull requests are welcome. Please run `bun run lint` and `bunx tsc --noEmit` before submitting. There is no automated test suite — validate changes manually in the browser, ideally in a Tesla browser or a Chromium-based mobile browser in touch emulation mode.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

You are free to fork, modify, and use this software for **personal, non-commercial purposes** (hobby projects, self-hosting for personal use, learning, experimentation). You may **not** use it to build a competing product, offer it as a service, or use it in any commercial context.
