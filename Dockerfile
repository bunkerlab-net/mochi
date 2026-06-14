FROM docker.io/oven/bun:1-alpine AS base

ARG YT_DLP_VERSION=
ENV MOCHI_BUNDLED_YT_DLP_PATH=/opt/yt-dlp/bin/yt-dlp

# Install ffmpeg and yt-dlp runtime dependencies
RUN apk add --no-cache \
    ffmpeg \
    tini \
    openssl \
    ca-certificates \
    python3 \
    py3-pip \
    && python3 -m venv /opt/yt-dlp \
    && if [ -n "${YT_DLP_VERSION}" ]; then \
        /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp==${YT_DLP_VERSION}"; \
    else \
        /opt/yt-dlp/bin/pip install --no-cache-dir yt-dlp; \
    fi \
    && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
    && chown -R bun:bun /opt/yt-dlp

# Install dependencies (with build tools for native modules) and generate the Prisma client
FROM base AS dependencies

WORKDIR /usr/app

RUN apk add --no-cache build-base python3

# Schema + config are needed by the postinstall `prisma generate` step;
# patches/ holds the bun patch that fixes the @discordjs/opus source build
# on linux/arm64 (must be present before install)
COPY package.json bun.lock schema.prisma prisma.config.ts ./
COPY migrations ./migrations
COPY patches ./patches

# --production omits devDependencies (typescript, biome, release-it, @types/*).
# The bundle and `prisma generate` only need runtime dependencies, so this
# node_modules is what the runner copies — no dev tooling ships in the image.
RUN bun install --frozen-lockfile --production

FROM dependencies AS builder

WORKDIR /usr/app

COPY . .

# Regenerate the Prisma client against the full source tree, then bundle with bun
RUN bun prisma generate
RUN bun run build

# Only keep what's necessary to run
FROM base AS runner

# Run as the image's baked-in non-root "bun" user (uid 1000). Setting USER before
# WORKDIR means both directories below are created owned by bun: /data holds the
# SQLite DB + media cache, /usr/app is the app root and working directory.
# (The yt-dlp venv was already handed to bun in the base stage.)
USER bun

WORKDIR /data
WORKDIR /usr/app

COPY --from=builder --chown=bun:bun /usr/app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /usr/app/dist ./dist
COPY --from=builder --chown=bun:bun /usr/app/src/generated ./src/generated
COPY --chown=bun:bun package.json bun.lock schema.prisma prisma.config.ts ./
COPY --chown=bun:bun migrations ./migrations

ARG COMMIT_HASH=unknown
ARG BUILD_DATE=unknown

ENV DATA_DIR=/data
ENV NODE_ENV=production
ENV COMMIT_HASH=$COMMIT_HASH
ENV BUILD_DATE=$BUILD_DATE
ENV ENV_FILE=/config

CMD ["tini", "--", "bun", "dist/migrate-and-start.js"]
