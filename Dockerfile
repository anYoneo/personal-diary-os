# syntax=docker/dockerfile:1

# Three long-lived processes share this one image: the web app (`next start`),
# the notification worker, and the Discord bot. Debian slim rather than Alpine
# because Prisma ships precompiled musl/glibc engines and glibc is the safe pick.

# ── Stage 1: dependencies ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# prisma/ comes along so the postinstall hook can generate the client.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ── Stage 2: build ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
# openssl must exist BEFORE `prisma generate`, otherwise Prisma mis-detects the
# platform and emits the openssl-1.1.x engine — which fails at runtime on
# bookworm (OpenSSL 3) with "could not locate the Query Engine for runtime".
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Throwaway URL. Every route is dynamic (ƒ), so the build never queries the
# database — it only needs the datasource to resolve.
ENV DATABASE_URL="file:./build-placeholder.db"
# Deliberately NO secrets here: the build must not need SESSION_SECRET or any
# credential. They are injected at runtime by compose/pm2.
RUN npx prisma generate && npm run build

# ── Stage 3: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3111
# The diary database and any uploads live on a mounted volume, never in the
# image — so redeploying the container cannot destroy the diary.
ENV DIARY_DATA_DIR=/data

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

# Reuse the already-installed tree (includes tsx, which runs the worker + bot).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/postcss.config.mjs ./postcss.config.mjs
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY public ./public

# Prisma's generated client is read from node_modules/.prisma at runtime.
RUN mkdir -p /data

EXPOSE 3111

# Health check hits an unauthenticated, DB-free route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/login" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
