# TeslaNav

Waze alerts (police, accidents, hazards, road closures) on your Tesla's in-car browser, on a real Waze basemap. Built with Next.js 16 (App Router), React 19, TypeScript 5, MapLibre GL, and Tailwind CSS 4.

**Self-hosted backend**: one Docker container with the app, in-memory Redis (caching), and SQLite (recordings/feedback). Maps use OpenFreeMap's public vector styles with no account or API key.

> **License**: Free for personal, non-commercial use. See [LICENSE](./LICENSE) for details.

## Features

- Real-time Waze alerts (police, accidents, hazards, road closures) with proximity warnings
- OpenFreeMap vector basemap (Liberty by default; seven dev-selectable map/hybrid styles)
- Esri global and USGS US-only satellite imagery modes with no map labels or road overlays
- Locally bundled Circular Std typography (Book, Medium, Bold, Black + italics)
- Automatic solar theme: dark one hour before sunset through one hour after sunrise
- GPS track recording and playback (GPX, stored in SQLite)
- Touch-optimized UI designed for Tesla's in-car Chromium browser
- No paid/API-key dependencies (no Mapbox, analytics, or cloud storage account)
- Always-on live alerts from Waze's read-only mobile RT protocol — no browser required
- Optional GeoRSS userscript enrichment for the live-map feed and future jam data

## Run with Docker (recommended)

```bash
docker build -t teslanav .
docker run -p 3000:3000 -v teslanav-data:/data teslanav
```

or with Docker Compose:

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). The container starts an in-memory Redis and the Next.js server; SQLite lives in the `/data` volume.

## Development

### Prerequisites

- [Bun](https://bun.sh) (package manager)
- A local Redis for the Waze cache (optional — routes degrade gracefully without it)

### Setup

```bash
git clone https://github.com/R44VC0RP/teslanav.com.git
cd teslanav.com
bun install
cp .env.example .env.local   # defaults work out of the box
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Add `?dev=true` to the URL to enable the tile-bounds debug overlay and verbose logging.

### Commands

```bash
bun run dev          # Start dev server (http://localhost:3000)
bun run build        # Production build
bun run start        # Start production server
bun run lint         # Run ESLint
bunx tsc --noEmit    # Type check
./deploy.sh          # Validate, backup, deploy, health-check, and rollback if needed
```

### exe.dev deployment

`deploy.sh` defaults to `victor-mesa.exe.xyz` and `/home/exedev/apps/teslanav`. It requires the gitignored `.env.exe-dev`, creates an online SQLite backup before each release, preserves the previous image for rollback, syncs source and secrets, builds on the x86 host, waits for Docker health, checks the public HTTPS endpoint, and keeps the latest 10 database backups plus three rollback images.

Override with `VM_HOST`, `APP_DIR`, `ENV_FILE`, or `HEALTH_URL`. Use `SKIP_CHECKS=1` only when local typecheck/build already passed in the same working tree.

## Environment Variables

All optional — see [.env.example](./.env.example):

```bash
REDIS_URL=redis://127.0.0.1:6379   # In-memory Redis (started inside the container)
DATABASE_PATH=./data/teslanav.db   # SQLite file (recordings + feedback)
ADMIN_API_KEY=                     # Bearer key for /api/admin/* (empty = no auth)
ANALYTICS_HASH_SECRET=             # Optional HMAC secret for anonymous visitor/session IDs
INBOUND_API_KEY=                   # Server-only key for suggestion email delivery
SUGGESTION_TO_EMAIL=me@teslanav.com # Destination for Settings suggestions
PUBLIC_BASE_URL=http://localhost:3000 # Public origin for metadata/social URLs
WAZE_RELAY_SECRET=                 # Shared secret for the alert relay userscript (empty = relay disabled)
```

## Architecture

```
app/api/           # Server-side API routes (Next.js Route Handlers)
  waze/            # Cache-first RT alerts + optional GeoRSS enrichment
  waze/relay/      # Optional relay endpoints (bounds out, GeoRSS data in)
  recording/       # GPX recordings in SQLite (save/list/download/delete)
  feedback/        # User feedback stored in SQLite
  admin/usage/     # Instance stats (SQLite counts, Redis keys, feedback)
  directions/      # STUB - empty (Mapbox removed)
  geocode/         # STUB - empty (LocationIQ removed)
  speedcameras/    # STUB - empty (OSM Overpass removed)

components/        # React UI components (Map.tsx = MapLibre GL + OpenFreeMap)
hooks/             # Custom React hooks (data fetching, GPS, GPX)
lib/               # Shared utilities
  redis.ts         # ioredis (lazy singleton)
  db.ts            # better-sqlite3 (lazy singleton)
  waze-rt.ts       # Read-only RT session, credentials, delta cache, refresh logic
  waze-rt-proto.ts # Embedded minimal proto2 schema for register/login/alert reads
  waze-relay.ts    # Optional GeoRSS enrichment relay
types/             # TypeScript interfaces
scripts/           # waze-relay.user.js (Tampermonkey relay) + dev utilities
```

Everything is local except Waze's RT alert servers and OpenFreeMap's public style/tile service. Redis is an in-memory cache; SQLite stores recordings, feedback, and stable RT credentials.

### How live Waze alerts work (no browser required)

The primary alert source is Waze's private mobile **RT protobuf protocol**, reconstructed by the MIT-licensed [highway-radar-sabre-plus](https://github.com/nicglazkov/highway-radar-sabre-plus) project and independently live-tested here. TeslaNav uses only its read path:

1. Register one anonymous account, persist its credentials and stable synthetic device identity in SQLite, and reuse them across container restarts.
2. Login to the regional RT host (`rt-xlb-am`, `rt-xlb-il`, or `rt-xlb-row`).
3. Send the normal `SeeMe` / `Location` / `MapDisplayed` handshake and progressively smaller viewport queries.
4. Merge stateful alert additions and `RmAlert` removals by UUID, then cache a bounded snapshot in Redis.

`/api/waze` never waits for the long-polling RT call. It immediately serves a fresh/stale snapshot and starts one background refresh when needed. A cold first request returns `503` for a few seconds; subsequent requests return in milliseconds. Snapshots older than five minutes are never shown as live safety data.

The implementation is deliberately **read-only**. It does not include report, confirm, discard, chat, or any other Waze write command. It assumes one Docker replica; Redis refresh locks prevent accidental duplicate pollers.

### Optional GeoRSS enrichment

Waze protects `live-map/api/georss` with reCAPTCHA Enterprise: every request needs a fresh `x-recaptcha-token` minted **on waze.com** plus that browser's httpOnly session cookies. There is no pure-HTTP path — but the fetch doesn't have to happen on *your* server.

RT works without this, but TeslaNav can optionally merge the richer GeoRSS result using a small **relay userscript** instead of a server-side browser:

1. Open [http://localhost:3000/waze-relay.user.js](http://localhost:3000/waze-relay.user.js) in a desktop browser with [Tampermonkey](https://www.tampermonkey.net/) installed and confirm the install.
2. Keep a tab open on `https://www.waze.com/live-map` on any always-on machine (same network as the container).
3. Configure the script from the Tampermonkey menu ("TeslaNav: Configure") with your TeslaNav URL and `WAZE_RELAY_SECRET`.

The script asks your server which bounds the car is looking at, fetches georss for those bounds inside waze.com (fresh token + its own cookies), and POSTs the alert JSON back every ~15s. Only alert data ever crosses — tokens and cookies never leave the browser. GeoRSS wins when both sources identify the same alert.

Without the relay, RT alerts, the map, recording, and the rest of the app continue to work normally.

### OpenFreeMap styles

The map uses the official OpenFreeMap vector styles directly through MapLibre. Standard mode automatically switches Liberty → Dark one hour before local sunset, then Dark → Liberty one hour after local sunrise. Sunrise/sunset is calculated locally from the car's coordinates (no weather/time API). The normal map button now toggles Standard/Satellite only; satellite keeps its imagery and is gently dimmed at night while labels use the dark OpenFreeMap style.

`?dev=true` adds a floating selector with Auto plus Positron, Bright, Liberty, Dark, Fiord, Satellite · Esri, and Satellite · USGS. A developer override persists in `teslanav-map-style`; choosing the normal Standard/Satellite toggle returns the selector to Auto. The normal mode persists as `teslanav-map-mode`.

Style URLs are `https://tiles.openfreemap.org/styles/{style}`. OpenFreeMap requires no account or API key. Attribution is supplied by the style sources: OpenFreeMap, OpenMapTiles, and OpenStreetMap contributors.

Satellite mode uses a minimal imagery-only MapLibre style: no location names, POIs, road lines, boundaries, or OpenFreeMap vector requests. Esri World Imagery provides polished global coverage; USGS Imagery Only provides official US orthoimagery and may be blank outside the United States. Both endpoints are CORS-enabled and require no application key.

### Typography

Circular Std is served locally as WOFF2 through `next/font/local`; no font CDN is used at runtime or build time. Loaded variants are Book 400, Medium 500, Bold 700, and Black 900 with matching italics. `font-synthesis: none` prevents the browser from inventing missing weights or italics.

### First-party analytics and logs

TeslaNav has a local analytics pipeline backed by SQLite — no analytics provider, cookies, or third-party tracking script. It records anonymous DAU/WAU/MAU, sessions, pageviews, visible engaged time, coarse device/Tesla and screen buckets, timezone/language, referrer host, map mode/style interactions, police-alert interactions, sponsor clicks, and aggregated application request counts. `/admin` shows 14-day activity, engagement, device mix, top pages/referrers/events/routes, process memory/uptime, RT health, feedback, and a bounded operational log.

Visitor and session UUIDs are generated in `localStorage`/`sessionStorage` and HMAC-hashed before SQLite storage. Exact location, IP address, complete user agent, query strings, and page content are not stored. Obvious bots, `/admin` usage, and static assets are excluded. `Do Not Track` is honored; users can also opt out with `localStorage.setItem("teslanav-analytics-optout", "true")`. Set `ANALYTICS_HASH_SECRET` to a deployment-specific random secret before public use.

### Suggestion box

Settings includes a first-party suggestion form. Suggestions are saved idempotently in SQLite before being emailed through Inbound v2 to `SUGGESTION_TO_EMAIL`. The Inbound key remains server-side. Same-origin validation, a hidden honeypot, minimum form time, strict 10–2,000 character validation, idempotency IDs, and Redis limits (3/hour and 8/day per hashed IP; 100/hour globally) protect the mailbox from abuse. Delivery failures remain in SQLite and the admin operational log.

## Contributing

Pull requests are welcome. Please run `bun run lint` and `bunx tsc --noEmit` before submitting. There is no automated test suite — validate changes manually in the browser, ideally in a Tesla browser or a Chromium-based mobile browser in touch emulation mode.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

You are free to fork, modify, and use this software for **personal, non-commercial purposes** (hobby projects, self-hosting for personal use, learning, experimentation). You may **not** use it to build a competing product, offer it as a service, or use it in any commercial context.
