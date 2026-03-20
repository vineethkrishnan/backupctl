# ── Build stage ───────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
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
    curl \
    tini

# Install restic
RUN wget https://github.com/restic/restic/releases/download/v0.17.3/restic_0.17.3_linux_amd64.bz2 \
    && echo "5097faeda6aa13167aae6e36efdba636637f8741fed89bbf015678334632d4d3  restic_0.17.3_linux_amd64.bz2" | sha256sum -c \
    && bunzip2 restic_0.17.3_linux_amd64.bz2 \
    && chmod +x restic_0.17.3_linux_amd64 \
    && mv restic_0.17.3_linux_amd64 /usr/local/bin/restic

# Run as non-root — SSH keys mounted to /home/node/.ssh
RUN mkdir -p /home/node/.ssh /home/node/.gnupg \
    && chmod 700 /home/node/.gnupg \
    && chown -R node:node /home/node/.ssh /home/node/.gnupg

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist/
RUN chown -R node:node /app

USER node

EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:${APP_PORT:-3100}/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
