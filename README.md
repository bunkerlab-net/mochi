<p align="center">
  <img width="250" height="250" src="https://raw.githubusercontent.com/bunkerlab-net/mochi/master/.github/logo.svg">
</p>

> [!IMPORTANT]
> Mochi is a fork of [Muse](https://github.com/museofficial/muse), the self-hosted Discord music bot originally created by Max Isom. It has been rebuilt on the [Bun](https://bun.com) runtime with a modern toolchain (TypeScript 6, Drizzle, Biome) and is maintained under the [`bunkerlab-net`](https://github.com/bunkerlab-net) organization.
>
> Docker images are published to `ghcr.io/bunkerlab-net/mochi`.

---

Mochi is a self-hosted Discord music bot for small to medium servers — think a group the size of you, your friends, and their friends. It keeps Muse's feature set and rebuilds it on a current, Bun-native stack.

![Hero graphic](.github/hero.png)

## Features

- 🎥 Livestreams
- ⏩ Seeking within a song/video
- 💾 Local caching for better performance
- 📋 No vote-to-skip — playback is controlled directly
- ↔️ Autoconverts playlists / artists / albums / songs from Spotify
- 🟠 Plays SoundCloud tracks, sets, and user profiles directly — no API key needed
- 🎤 Queues an artist's or channel's tracks from a YouTube / YouTube Music channel link
- ⭐ Users can save favorite queries for reuse
- 1️⃣ A single instance supports multiple guilds
- 🔊 Configurable volume controls, including optional ducking when people speak
- 📖 Built-in `/help` that lists every command and what it does
- ✍️ Written in TypeScript, easily extendable

## Stack

Mochi runs entirely on [Bun](https://bun.com) — runtime, package manager, and bundler.

- **Runtime:** Bun `1.3.14` (Node.js 24+ compatible)
- **Language:** TypeScript 6 (strict)
- **Discord:** discord.js 14 + `@discordjs/voice`
- **Database:** Drizzle ORM over SQLite using Bun's built-in `bun:sqlite`
- **Media:** `ffmpeg` + `yt-dlp`
- **Tooling:** Biome (lint/format), `hk` (git hooks)

## Requirements

Running Mochi needs a Discord token and a YouTube API key. Spotify and Last.fm keys are optional — Spotify keys enable Spotify URL conversion, and a Last.fm key improves [autoplay](#autoplay) recommendations:

- `DISCORD_TOKEN` — create a 'New Application' [here](https://discord.com/developers/applications), then add a 'Bot'.
- `YOUTUBE_API_KEY` — [create a project](https://console.developers.google.com), enable the YouTube Data API, and create an API key under credentials.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` (optional) — create a Client ID [here](https://developer.spotify.com/dashboard/applications).
- `LASTFM_API_KEY` (optional) — create an [API account](https://www.last.fm/api/account/create) (you only need the **API key** it issues). Improves autoplay recommendations; without it, autoplay falls back to YouTube mixes.

A 64-bit OS is required.

On first run Mochi logs an invite URL — open it in a browser to add Mochi to your server. Mochi DMs the server owner with setup instructions once it's added.

## Running

You can run Mochi with Docker (recommended) or from source with Bun.

### 🐳 Docker

Available image tags:

- `:latest` — the most recent release
- `:3`, `:3.0`, `:3.0.0` — semver major / minor / exact
- `:yt-dlp-latest` — the latest release rebuilt with the newest available `yt-dlp`

Replace the empty config values below:

```bash
docker run -it -v "$(pwd)/data":/data \
  -e DISCORD_TOKEN='' \
  -e YOUTUBE_API_KEY='' \
  -e SPOTIFY_CLIENT_ID='' \
  -e SPOTIFY_CLIENT_SECRET='' \
  -e LASTFM_API_KEY='' \
  ghcr.io/bunkerlab-net/mochi:latest
```

This starts Mochi and creates a `data` directory in your current directory for the database and cache.

You can also store tokens in an environment file and make it available to the container. By default the container reads a `/config` env file; customize the path with the `ENV_FILE` environment variable (handy for [Docker secrets](https://docs.docker.com/engine/swarm/secrets/)).

**Docker Compose:**

```yaml
services:
  mochi:
    image: ghcr.io/bunkerlab-net/mochi:latest
    restart: always
    volumes:
      - ./mochi:/data
    environment:
      - DISCORD_TOKEN=
      - YOUTUBE_API_KEY=
      - SPOTIFY_CLIENT_ID=
      - SPOTIFY_CLIENT_SECRET=
      - LASTFM_API_KEY=
```

Keep the same `DISCORD_TOKEN`, reuse the same `/data` volume, and point the service at a newer image tag to upgrade in place — Mochi comes back up with the same bot identity and persisted database/cache.

### From source (Bun)

**Prerequisites:**

- [Bun](https://bun.com) `1.3.14` or newer
- Node.js 24 or newer
- `ffmpeg` (4.1 or later)
- `yt-dlp` on your `PATH` (or set `YT_DLP_PATH` to its full path)

```bash
git clone https://github.com/bunkerlab-net/mochi.git
cd mochi
cp .env.example .env   # then fill in your tokens
bun install
bun start              # runs pending migrations, then starts Mochi
```

For local development, `bun dev` runs Mochi with file watching and auto-reload.

## ⚙️ Configuration (advanced)

All settings below are environment variables (set them in your `.env` file or container environment).

### Logging

Mochi logs through [pino](https://getpino.io). Two environment variables control output:

- `LOG_FORMAT` (default `plain`): `plain` for human-readable colorized lines, `json` for one JSON record per line, or `ecs` for [Elastic Common Schema](https://www.elastic.co/guide/en/ecs/current/index.html) JSON (for log shippers).
- `LOG_LEVEL` (default `info`): one of `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. Operational events and failures log at `info` and above; set `LOG_LEVEL=debug` for verbose per-component detail.

### Cache

Mochi limits the total cache size to ~2 GB by default. Change it with `CACHE_LIMIT`, e.g. `CACHE_LIMIT=512MB` or `CACHE_LIMIT=10GB`.

### yt-dlp

Mochi uses `yt-dlp` to resolve playable YouTube and SoundCloud media URLs. The Docker image bundles it. For source installs, put `yt-dlp` on your `PATH` or set `YT_DLP_PATH`.

Set `YT_DLP_AUTO_UPDATE=true` to have Mochi attempt to update its configured `yt-dlp` before connecting to Discord. This works best with the Docker image's bundled virtualenv, or when `YT_DLP_PATH` points at a virtualenv or standalone `yt-dlp` executable Mochi can update.

The `ghcr.io/bunkerlab-net/mochi:yt-dlp-latest` image is rebuilt on a schedule from the latest release with the newest `yt-dlp` from PyPI. Versioned refresh tags are also published as `:<mochi-version>-yt-dlp-<yt-dlp-version>`.

### SponsorBlock

Mochi can skip non-music segments at the start or end of a YouTube music video using [SponsorBlock](https://sponsor.ajay.app/). It's disabled by default; enable it with `ENABLE_SPONSORBLOCK=true`.

Because SponsorBlock is a public service, it may be down or overloaded. When that happens, Mochi pauses SponsorBlock requests for a few minutes. Adjust the pause duration (in minutes) with `SPONSORBLOCK_TIMEOUT`.

### Autoplay

When the queue runs out, Mochi keeps the music going by finding tracks similar to the one that just played (radio mode) instead of falling silent. It's **on by default** — toggle it per-server with `/config set autoplay true|false`, and check the current state with `/config get autoplay`.

Mochi sources similar music two ways:

- **Last.fm** (preferred) — when `LASTFM_API_KEY` is set, Mochi uses Last.fm's similar-track recommendations and resolves them to playable YouTube videos. Create a key via a Last.fm [API account](https://www.last.fm/api/account/create); only the issued **API key** is needed.
- **YouTube mixes** (fallback) — when no Last.fm key is set, or Last.fm returns nothing, Mochi seeds YouTube's auto-generated radio mix for the last track. This needs no extra configuration.

Autoplay seeds from the last track, so it only continues when that track is a YouTube source; live streams and direct HTTP streams can't be seeded.

`/play` and `/playnow` take an `autoplay:true|false` option that overrides the server setting for the current session only, so you can silence the radio for one listening session without touching `/config`. The override sticks for the rest of the session: a later `/play` that omits the option keeps it, and only an explicit `true`/`false` changes it. It ends with the session at `/stop` (or Mochi leaving an empty channel), after which the server setting applies again; `/disconnect` keeps it, since the queue survives.

#### Mixes on demand

`/play query:… mix:true` starts a YouTube mix (radio) immediately instead of waiting for the queue to empty: Mochi queues the track the query resolved, then fills up to the server's `playlist-limit` from that track's mix. A mix radiates from one video, so a query resolving several tracks (a playlist, album, or channel) keeps only the first as the seed. Mixes are a YouTube feature; other sources report that no mix is available.

### Custom bot status

By default Mochi shows "Online" and "Listening to music". Override it with:

- `BOT_STATUS`: `online`, `idle` (Away), or `dnd` (Do Not Disturb)
- `BOT_ACTIVITY_TYPE`: `PLAYING`, `LISTENING`, `WATCHING`, or `STREAMING`
- `BOT_ACTIVITY`: the text that follows the activity type
- `BOT_ACTIVITY_URL`: required when using `STREAMING` — a regular YouTube or Twitch stream URL

**Examples**

Watching a movie, Do Not Disturb:

```
BOT_STATUS=dnd
BOT_ACTIVITY_TYPE=WATCHING
BOT_ACTIVITY=a movie
```

Streaming Monstercat:

```
BOT_STATUS=online
BOT_ACTIVITY_TYPE=STREAMING
BOT_ACTIVITY_URL=https://www.twitch.tv/monstercat
BOT_ACTIVITY=Monstercat
```

### Bot-wide commands

If Mochi runs in many guilds (10+), you may want to register commands bot-wide instead of per guild. Set `REGISTER_COMMANDS_ON_BOT=true`. The trade-off: command updates can take up to an hour to propagate.

### Turn down volume when people speak

Configure Mochi to automatically duck the volume while people are speaking:

- `/config set reduce-vol-when-voice true` — enable automatic volume reduction
- `/config set reduce-vol-when-voice false` — disable it
- `/config set reduce-vol-when-voice-target <volume>` — target volume percentage while people speak (0–100, default 20)

### ffmpeg path

If `ffmpeg` isn't on your `PATH` (common on Windows), set `FFMPEG_PATH` to the full path of the `ffmpeg` executable.

## Versioning

The `master` branch is the bleeding-edge development branch and is not guaranteed to be stable. For production, run a tagged [release](https://github.com/bunkerlab-net/mochi/releases/).

## License

Mochi is released under the [MIT License](LICENSE). As a fork of [Muse](https://github.com/museofficial/muse), it retains the original copyright (© 2020 Max Isom) alongside the fork's.
