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
    SONDARA_DATABASE_URL=postgresql://sondara:sondara@postgres:5432/sondara \
    SONDARA_WEB_ORIGIN=http://localhost:4176

# Install tini and a pg_dump client matching the PostgreSQL 17 service.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server-dist ./server-dist
COPY --from=builder /app/server/db/migrations-pg ./server/db/migrations-pg

# Data volume
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 4176

# Serve static frontend + API from a single process
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4176/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server-dist/index.js"]
