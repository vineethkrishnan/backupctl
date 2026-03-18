FROM node:20-alpine

RUN apk add --no-cache \
    postgresql-client \
    mysql-client \
    mongodb-tools \
    openssh-client \
    gnupg \
    fuse \
    bzip2

# Install restic
RUN wget https://github.com/restic/restic/releases/download/v0.17.3/restic_0.17.3_linux_amd64.bz2 \
    && bunzip2 restic_0.17.3_linux_amd64.bz2 \
    && chmod +x restic_0.17.3_linux_amd64 \
    && mv restic_0.17.3_linux_amd64 /usr/local/bin/restic

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY config/ ./config/

EXPOSE 3100
CMD ["node", "dist/main.js"]
