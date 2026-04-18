# ── Build stage: NestJS ────────────────────────────────────
FROM node:20-alpine3.22 AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/
RUN npm run build

# ── Build stage: restic with patched dependencies ─────────
FROM golang:1.26.1-alpine AS restic-builder

RUN apk add --no-cache git
WORKDIR /build
RUN git clone --branch v0.18.1 --depth 1 https://github.com/restic/restic.git .
RUN go get golang.org/x/crypto@v0.49.0 \
    && go get golang.org/x/net@v0.52.0 \
    && go get google.golang.org/grpc@latest \
    && go get google.golang.org/protobuf@latest \
    && go get go.opentelemetry.io/otel/sdk@latest \
    && go get go.opentelemetry.io/otel/sdk/metric@latest \
    && go mod tidy
RUN CGO_ENABLED=0 go build -tags disable_grpc_modules -ldflags "-s -w" -o /restic ./cmd/restic

# ── Production dependencies (clean layer, no npm cache) ───
FROM node:20-alpine3.22 AS deps

RUN npm install -g npm@latest
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── Migrator stage: runs TypeORM migrations against audit DB ──
# Keeps npm/npx available (unlike the stripped runtime stage below)
# so the upgrade/deploy scripts can run migrations without exec'ing
# into the long-running backupctl container.
FROM node:20-alpine3.22 AS migrator

WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules/
COPY --from=builder /app/dist ./dist/
CMD ["npx", "typeorm", "migration:run", "-d", "dist/db/datasource.js"]

# ── Production stage ──────────────────────────────────────
FROM node:20-alpine3.22

RUN apk upgrade --no-cache \
    && apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main busybox \
    && apk add --no-cache \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
    --repository=https://dl-cdn.alpinelinux.org/alpine/v3.22/community \
    postgresql17-client \
    mariadb-client \
    mongodb-tools \
    openssh-client \
    gnupg \
    fuse3 \
    docker-cli \
    curl \
    tini \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && rm -rf /root/.npm

COPY --from=restic-builder /restic /usr/local/bin/restic

# Pre-create backup base dir so the node user can write to it even if
# the host volume mount creates it as root on first run.
RUN mkdir -p /data/backups/.logs /data/backups/.fallback-audit \
    && chown -R node:node /data/backups

# Run as non-root — SSH keys mounted to /home/node/.ssh
RUN mkdir -p /home/node/.ssh /home/node/.gnupg \
    && chmod 700 /home/node/.gnupg \
    && chown -R node:node /home/node/.ssh /home/node/.gnupg

WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules/
COPY --from=builder /app/dist ./dist/
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chown -R node:node /app

USER node

EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:${APP_PORT:-3100}/health || exit 1
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
