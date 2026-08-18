FROM oven/bun:1.3.14-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY services/telemetry-forwarder.ts ./services/telemetry-forwarder.ts

USER bun
CMD ["bun", "run", "services/telemetry-forwarder.ts"]
