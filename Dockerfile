# ── Build stage ──
FROM node:24.18.0-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json drizzle.config.ts ./
COPY server/ ./server/
COPY src/ ./src/
COPY index.html vite.config.ts ./

# Build frontend and server
RUN npm run build

# ── Production stage ──
FROM node:24.18.0-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    SONDARA_API_HOST=0.0.0.0 \
    SONDARA_API_PORT=4176 \
    SONDARA_DATABASE_PATH=/app/data/sondara.sqlite \
    SONDARA_WEB_ORIGIN=http://localhost:4176

# Install the process supervisor only; SQLite runs in-process.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server-dist ./server-dist
COPY --from=builder /app/server/db/migrations-sqlite ./server/db/migrations-sqlite

# Data volume
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 4176

# Serve static frontend + API from a single process
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4176/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server-dist/index.js"]
