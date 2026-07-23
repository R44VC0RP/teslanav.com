# AGENTS.md - TeslaNav Codebase Guidelines

TeslaNav shows Waze alerts on Tesla's in-car browser. Built with Next.js 16 (App Router), React 19, TypeScript 5, MapLibre GL, and Tailwind CSS 4.

**The app is fully self-contained**: a single Docker container runs Next.js, an in-memory Redis (caching/rate limiting), and SQLite (recordings/feedback). There are no external map, geocoding, analytics, or storage services — the only upstream call is to the Waze live-map API.

## Build, Lint & Test Commands

```bash
bun install              # Install dependencies (package manager: Bun)
bun run dev              # Start dev server (http://localhost:3000)
bun run build            # Production build
bun run start            # Start production server
bun run lint             # Run ESLint across project
bunx eslint <file>       # Lint a specific file
bunx eslint --fix <file> # Auto-fix lint issues in a file
bunx tsc --noEmit        # Type check without emitting output
bun run scripts/test-waze-bounds.ts  # Manual Waze API bounds test (CLI utility)

docker build -t teslanav .           # Build the self-contained image
docker run -p 3000:3000 -v teslanav-data:/data teslanav
docker compose up -d                 # Same thing via Compose
./deploy.sh                           # Backup + deploy to exe.dev + health check/rollback
```

**No test framework is configured.** There are no unit/integration tests. Validation is done via TypeScript strict mode and manual browser testing. Add `?dev=true` to the URL to enable debug overlays.

## Project Structure

```
app/                    # Next.js App Router - pages and API routes
  api/                  # Server-side API routes (route.ts per endpoint)
  admin/                # Admin dashboard (SQLite/Redis instance stats)
  record/               # GPX track recording page
  view/                 # GPX track playback page
components/             # React components (ui/ for shadcn/ui primitives)
hooks/                  # Custom React hooks (use* prefix, camelCase.ts files)
lib/                    # Shared server/client utilities
  redis.ts              # ioredis client (lazy singleton), cache keys, TTLs, rate limits
  db.ts                 # better-sqlite3 (lazy singleton): recordings + feedback tables
  map-styles.ts         # OpenFreeMap style allowlist + default
  waze-rt.ts            # Read-only RT sessions, caching, refresh, alert normalization
  waze-rt-proto.ts      # Embedded minimal Waze RT proto2 schema
  waze-relay.ts         # Optional GeoRSS enrichment relay
  utils.ts              # cn() = clsx + tailwind-merge
  gpx.ts                # GPX generation, parsing, interpolation
types/                  # TypeScript type definitions (one file per domain)
scripts/                # waze-relay.user.js (Tampermonkey relay) + dev utilities
public/                 # Static assets; waze-relay.user.js is also served from here for easy install
Dockerfile              # Multi-stage: deps -> build -> runner (redis-server + standalone)
docker-entrypoint.sh    # Starts in-memory redis-server, then `node server.js`
docker-compose.yml      # Single service + named volume for /data (SQLite)
```

## Code Style Guidelines

### Import Organization

```typescript
"use client";  // 1. Directive first (if needed)

import { useState, useCallback } from "react";  // 2. React
import maplibregl from "maplibre-gl";           // 3. External packages
import { cn } from "@/lib/utils";               // 4. Internal path-aliased (@/)
import { LocalComp } from "./LocalComp";        // 5. Relative imports
import type { MyType } from "@/types/foo";      // 6. Type-only imports last
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Components | PascalCase | `SettingsModal` |
| Component files | PascalCase.tsx | `Map.tsx`, `FeedbackModal.tsx` |
| Hooks | camelCase `use` prefix | `useGeolocation`, `useWazeAlerts` |
| Hook files | camelCase.ts | `useGeolocation.ts` |
| Types/Interfaces | PascalCase | `WazeAlert`, `RouteData` |
| Type files | camelCase.ts | `waze.ts`, `route.ts` |
| API routes | route.ts | `app/api/waze/route.ts` |
| Constants | UPPER_SNAKE_CASE | `CACHE_TTL`, `RATE_LIMITS` |
| Functions/variables | camelCase | `fetchAlerts`, `handleClick` |
| localStorage keys | `teslanav-` prefix | `teslanav-map-mode`, `teslanav-follow-mode` |

### TypeScript Guidelines

- **Strict mode is enabled** — all code must pass `bunx tsc --noEmit`
- Use `interface` for object shapes that may be extended; `type` for unions and computed types
- Prefer explicit return types on all exported functions
- Use the `type` keyword for type-only imports: `import type { Foo } from "..."`
- No `any` — use `unknown` with narrowing or proper generic types
- Zod (`zod`) is available for runtime validation of external API responses

### Component Patterns

```typescript
"use client";

import { useState, useCallback, forwardRef } from "react";

interface MyComponentProps {
  required: string;
  optional?: number;
  onAction?: (value: string) => void;
}

// Named exports for components (not default exports, except page.tsx files)
export const MyComponent = forwardRef<HTMLDivElement, MyComponentProps>(
  function MyComponent({ required, optional = 0, onAction }, ref) {
    const handleClick = useCallback(() => {
      onAction?.(required);
    }, [onAction, required]);

    return <div ref={ref} onClick={handleClick}>{/* content */}</div>;
  }
);
```

- Page files (`app/**/page.tsx`) use `export default function`
- All other components use named exports: `export const Foo = ...` or `export function Foo`
- Wrap callbacks in `useCallback` with proper dependency arrays
- Use `useRef` for animation frames, timers, DOM elements, and mutable counters that should not trigger re-renders
- Private helper sub-components (not exported) may live at the bottom of a file
- Prefer inline SVG for one-off icons rather than importing from lucide-react

### State Management

- `useState` with lazy initializer for localStorage-persisted preferences:
  ```typescript
  const [mode, setMode] = useState(() => localStorage.getItem("teslanav-map-mode") ?? "standard");
  ```
- `useRef` for values that should not trigger re-renders (animation state, timers, previous values)
- Dark mode is passed as a prop (`isDarkMode: boolean`), not via context or CSS class
- Server-side cache/rate limiting uses Redis (`@/lib/redis`); persistent data uses SQLite (`@/lib/db`)

### API Route Patterns

Cache-backed API routes follow: **validate params → check Redis cache → (record fetch need) → return cached data or 503**. Relay/write routes follow: **authorize (Bearer) → validate → store in Redis/SQLite → return**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { redis, CACHE_KEYS, CACHE_TTL } from "@/lib/redis";

export async function GET(request: NextRequest) {
  const param = request.nextUrl.searchParams.get("param");
  if (!param) {
    return NextResponse.json({ error: "Missing required parameter" }, { status: 400 });
  }

  // Cache check
  const cached = await redis.get<DataType>(CACHE_KEYS.myKey(param));
  if (cached) return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });

  try {
    const data = await fetchUpstream(param);
    await redis.set(CACHE_KEYS.myKey(param), data, { ex: CACHE_TTL.MY_TTL });
    return NextResponse.json(data, { headers: { "X-Cache": "MISS" } });
  } catch (error) {
    console.error("[MyAPI] fetch failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- Return stale cache rather than hard-failing when upstream is unavailable
- Log errors with `[RouteName]` prefix: `console.error("[Waze]", error)`
- Consistent error shape: `{ error: "message" }` with appropriate HTTP status
- Include `X-Cache: HIT | MISS | STALE` header on cacheable responses
- `lib/redis.ts` and `lib/db.ts` connect **lazily** (no side effects at module import) so `next build` page-data collection never touches the network or filesystem

### Error Handling

- Wrap all async operations in `try/catch`
- Rate-limited endpoints return `429` with an empty-data body (graceful degradation, not hard failure)
- Stale Redis cache is preferred over an upstream error response

### Styling

- Tailwind CSS v4 (CSS-first config via `app/globals.css` — no `tailwind.config.*` file)
- Use `cn()` from `@/lib/utils` to merge conditional classes:
  ```typescript
  <div className={cn("base-classes", isActive && "active-classes", className)} />
  ```
- CSS custom properties are defined with `oklch()` color values in `globals.css`

### Hooks Pattern

```typescript
// hooks/useMyFeature.ts
export function useMyFeature(param: string) {
  const [data, setData] = useState<DataType | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // setup
    return () => {
      // cleanup: clear timers, cancel animation frames, abort fetches
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [param]);

  return { data };
}
```

- Always clean up timers, `requestAnimationFrame` handles, and `watchPosition` IDs in effect cleanup
- Debounce map-dependent fetches (250–300ms) to avoid over-fetching on pan/zoom
- Use `useRef` to store the last fetch bounds; only re-fetch when movement exceeds a threshold

## Key Libraries

| Library | Usage |
|---------|-------|
| `maplibre-gl` | OpenFreeMap vector styles + imagery-only Esri/USGS satellite modes |
| `ioredis` | Alert snapshots, RT credentials/locks, and tile cache |
| `better-sqlite3` | GPX recordings + feedback storage |
| `protobufjs` | Minimal read-only Waze RT protocol encoding/decoding |
| `zod` | Runtime validation of external API responses |
| `@radix-ui/*` | Accessible UI primitives (via shadcn/ui) |
| `lucide-react` | Icon library |
| `class-variance-authority` | Component variant styling |
| `clsx` + `tailwind-merge` | Conditional class merging (`cn()`) |

## Environment Variables

```bash
REDIS_URL           # Redis endpoint (default redis://127.0.0.1:6379, started in-container)
DATABASE_PATH       # SQLite file path (default ./data/teslanav.db, /data/teslanav.db in Docker)
ADMIN_API_KEY       # Optional Bearer token for /api/admin/* routes
ANALYTICS_HASH_SECRET # Optional deployment-specific HMAC secret for anonymous analytics IDs
INBOUND_API_KEY     # Server-only Inbound v2 API key for suggestions
SUGGESTION_TO_EMAIL # Suggestion destination (default me@teslanav.com)
ANALYTICS_DIGEST_TO # Daily analytics recipient; empty disables the scheduler
ANALYTICS_DIGEST_TIMEZONE # IANA timezone for report day and send hour
ANALYTICS_DIGEST_HOUR # Local send hour, 0-23 (default 9)
PUBLIC_BASE_URL     # Public origin used for metadata/social URLs
WAZE_RELAY_SECRET   # Shared secret for /api/waze/relay (empty = relay disabled)
```

## Special Notes

1. **Tesla Browser**: Optimized for Tesla's in-car Chromium browser. Avoid hover-only interactions. Test with touch events.
2. **Dev Mode**: Add `?dev=true` to the URL to enable tile bounds debug overlay and verbose logging.
3. **Waze polling**: `/api/waze` is cache-first and request-triggered. It never waits for RT long polls; one Redis-locked background refresh per region updates snapshots. The Docker service assumes one replica.
4. **Path Alias**: Always use `@/` for imports from project root (configured in `tsconfig.json`).
5. **No Tailwind config file**: Tailwind v4 is configured entirely in `app/globals.css`. Do not create `tailwind.config.*`.
6. **No external services**: do not add calls to external map/geocoding/analytics/storage APIs. `/api/directions`, `/api/geocode`, and `/api/speedcameras` are intentional empty stubs left as seams.
7. **Map style**: `components/Map.tsx` loads OpenFreeMap vector styles directly. `lib/map-styles.ts` is the allowlist (Positron, Bright, Liberty, Dark, Fiord, Satellite · Esri, Satellite · USGS). `hooks/useSolarTheme.ts` + `lib/solar.ts` calculate sunrise/sunset locally: automatic dark starts one hour before sunset and ends one hour after sunrise. The production toggle controls only Standard/Satellite (`teslanav-map-mode`); Standard uses Liberty/Dark automatically. Satellite uses a minimal raster-only style (no names, POIs, roads, boundaries, sprites, glyphs, or OpenFreeMap vector requests) and only dims the imagery at night. The `?dev=true` selector adds Auto plus explicit overrides and persists `teslanav-map-style`. Style changes remount `<Map key={...}>` so all runtime route/debug layers are reconstructed. No map account/token is required. USGS is US-only.
13. **UI icons**: primary map controls use `lucide-react` (Settings, Satellite, Map, Help, Crosshair, Plus, Minus). Do not add hand-drawn replacements for controls already covered by Lucide; specialized Waze/Tesla alert artwork remains local custom SVG.
14. **Analytics privacy**: `components/Analytics.tsx`, `/api/analytics`, and the request `proxy.ts` are first-party only. IDs are HMAC-hashed; never store IPs, exact coordinates, raw user agents, query strings, or user-provided content. Honor DNT and `teslanav-analytics-optout`; exclude admin/static traffic. Feature event names/values are allowlisted to avoid high-cardinality or sensitive data. Raw behavioral events are not retained — only aggregate daily counters and coarse session rows.
15. **Suggestions**: `components/SuggestionBox.tsx` submits to `/api/suggestions`. Keep `INBOUND_API_KEY` server-only. Every suggestion is persisted in SQLite before email, keyed by a client UUID for idempotency. Preserve same-origin checks, honeypot, timing check, 10–2,000 character limit, escaped email HTML, Redis hashed-IP/global limits, bounded email timeout, and failure logging. Never include requester IP or location in suggestion emails.
16. **Deployment**: use `deploy.sh`, not ad-hoc rsync/Compose commands. It reads gitignored `.env.exe-dev`, locks concurrent deploys, runs local checks, creates an online SQLite backup, tags the current image for rollback, syncs/builds remotely, waits for Docker health/public HTTPS, automatically rolls back failures, and bounds retained backups/images.
17. **Daily analytics digest**: `scripts/daily-digest-scheduler.mjs` calls the protected `/api/admin/daily-digest` route after the configured local hour. Delivery reservations in SQLite and Inbound idempotency prevent duplicates; failures remain retryable and are recorded in app logs. Keep recipient/API credentials server-only. Hourly visitor/page/event tables exist to produce DST-safe local-day reports without adding raw analytics events or personal data.
8. **RT primary path**: `lib/waze-rt.ts` is read-only. It pins protocol 234 / app 5.17.1.0, persists one stable anonymous credential/device per region in SQLite, serializes all commands through one refresh, handles in-band `504 Retry`, merges `AddAlertAction` + `RmAlert` deltas by UUID, and refuses to serve snapshots older than five minutes. Do not add reporting, voting, chat, or other write commands. If Waze returns `APP_VERSION_NOT_SUPPORTED`, stop and re-verify constants against a newer client rather than guessing.
9. **Optional GeoRSS path**: georss needs a hostname-bound reCAPTCHA token plus the minting browser's httpOnly cookies. The userscript (`scripts/waze-relay.user.js`, served at `/waze-relay.user.js`) performs the fetch in-page and POSTs alert JSON for optional enrichment. RT remains functional without it.
10. **WazeAlert IDs**: the API-facing shape uses georss-compatible `id` (`alert-<numeric>/<uuid>`). Internally RT state is keyed by the bare UUID; do not use the numeric ID for delta merging.
11. **Third-party attribution**: RT schema/wire behavior is adapted from MIT-licensed highway-radar-sabre-plus; preserve `THIRD_PARTY_NOTICES.md` when changing or redistributing it.
12. **Typography**: Circular Std is locally bundled in `app/fonts/` as WOFF2 and loaded by `next/font/local` in `app/layout.tsx` at 400/500/700/900 plus italics. Keep `font-synthesis: none`; do not reintroduce Google Fonts or serve desktop OTF files directly.
