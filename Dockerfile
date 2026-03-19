# ── Build stage ───────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ──────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
    --repository=https://dl-cdn.alpinelinux.org/alpine/v3.20/community \
    postgresql17-client \
    mariadb-client \
    mongodb-tools \
    openssh-client \
    gnupg \
    fuse3 \
    bzip2 \
    curl

# Install restic
RUN wget https://github.com/restic/restic/releases/download/v0.17.3/restic_0.17.3_linux_amd64.bz2 \
    && bunzip2 restic_0.17.3_linux_amd64.bz2 \
    && chmod +x restic_0.17.3_linux_amd64 \
    && mv restic_0.17.3_linux_amd64 /usr/local/bin/restic

# Run as non-root — SSH keys mounted to /home/node/.ssh
RUN mkdir -p /home/node/.ssh /home/node/.gnupg \
    && chmod 700 /home/node/.gnupg \
    && chown -R node:node /home/node/.ssh /home/node/.gnupg

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist/
RUN chown -R node:node /app

USER node

EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${APP_PORT:-3100}/health || exit 1
CMD ["node", "dist/main.js"]
