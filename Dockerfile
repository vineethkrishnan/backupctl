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

RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/v3.20/community \
    postgresql-client \
    mariadb-client \
    mongodb-tools \
    openssh-client \
    gnupg \
    fuse3 \
    bzip2

# Install restic
RUN wget https://github.com/restic/restic/releases/download/v0.17.3/restic_0.17.3_linux_amd64.bz2 \
    && bunzip2 restic_0.17.3_linux_amd64.bz2 \
    && chmod +x restic_0.17.3_linux_amd64 \
    && mv restic_0.17.3_linux_amd64 /usr/local/bin/restic

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist/

EXPOSE 3100
CMD ["node", "dist/main.js"]
