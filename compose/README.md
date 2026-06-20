# Mochi Compose stack

This Compose stack runs Mochi plus three helper containers:

| Service      | Image                                      | Role                                                                           |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------ |
| `mochi`      | `ghcr.io/bunkerlab-net/mochi:latest`       | The Discord music bot.                                                         |
| `warp`       | `caomingjun/warp`                          | Cloudflare WARP egress. Mochi sends all of its traffic through this container. |
| `watchtower` | `ghcr.io/nicholas-fedor/watchtower:latest` | Updates the running containers to newer images once an hour.                   |
| `autoheal`   | `willfarrell/autoheal`                     | Restarts any container that reports an `unhealthy` healthcheck.                |

It does more than the single-container example in the [root README](../README.md#-docker). If you just want to try Mochi, that `docker run` snippet is simpler.

## Why WARP?

Mochi resolves media with `yt-dlp`, and YouTube rate-limits and bot-checks requests from datacenter IP ranges (the usual `429` and "Sign in to confirm you're not a bot" failures). Sending the bot's traffic through Cloudflare WARP gives it a residential-style consumer IP, which avoids most of that throttling.

The wiring is `network_mode: service:warp` on the `mochi` service: Mochi shares the `warp` container's network namespace instead of getting its own, with a few consequences:

- All of Mochi's outbound traffic leaves through the WARP container.
- Mochi has no network of its own, so it cannot publish ports. That is fine, since Mochi only makes outbound connections (Discord gateway and voice). To expose a port for it, add the mapping to the `warp` service instead.
- The WARP SOCKS5 proxy is published on `1080`, reachable at `localhost:1080` inside the shared namespace.
- Mochi waits for `warp` to report healthy before it starts (`depends_on: condition: service_healthy`); the `warp` image ships its own healthcheck.

`warp` runs `privileged` with `NET_ADMIN` (plus `MKNOD` and `AUDIT_WRITE`) and the IPv6 and `src_valid_mark` sysctls, because the WARP client manages the container's routing and WireGuard interface. Because of that, the stack targets a Linux Docker host; the privileged networking and sysctls do not translate cleanly to Docker Desktop on macOS or Windows.

For a WARP+ subscription, uncomment and set `WARP_LICENSE_KEY` in the `warp` service.

## Layout

```plaintext
compose/
  docker-compose.yaml
  mochi/           # bind-mounted to mochi's /data; holds the SQLite DB, media cache, and .env
    .gitignore
  warp/            # bind-mounted to /var/lib/cloudflare-warp; holds WARP registration state
    .gitignore
```

`mochi/` and `warp/` are tracked directories whose contents are ignored (`**` except `.gitignore`). The empty mount points stay in version control, while your secrets, database, cache, and WARP state stay out of git.

## Prerequisites

- A Linux host with Docker Engine and the Docker Compose v2 plugin.
- A Discord bot token and a YouTube API key (see the [root requirements](../README.md#requirements)). Spotify and Last.fm keys are optional.

## Setup

1. Create the environment file at `compose/mochi/.env`. The `mochi` service loads it via `env_file`, and it is gitignored, so it is the right place for secrets. A minimal file:

   ```dotenv
   # Required
   DISCORD_TOKEN=your-discord-bot-token
   YOUTUBE_API_KEY=your-youtube-api-key

   # Optional: enables Spotify URL conversion
   SPOTIFY_CLIENT_ID=
   SPOTIFY_CLIENT_SECRET=

   # Optional: improves autoplay recommendations (falls back to YouTube mixes if unset)
   LASTFM_API_KEY=

   # Optional tuning (see the root README's "Configuration" section)
   # CACHE_LIMIT=2GB
   # LOG_LEVEL=info
   # ENABLE_SPONSORBLOCK=true
   ```

   Leave `DATA_DIR` alone; the image already points it at `/data`, which is the `./mochi` bind mount. The root README documents the full list of variables (logging, SponsorBlock, bot status, yt-dlp auto-update, and so on) in its [Configuration section](../README.md#-configuration-advanced).

2. Start the stack from this directory:

   ```bash
   cd compose
   docker compose up -d
   ```

3. Find the invite URL. On first run Mochi logs an invite link; open it to add the bot to your server:

   ```bash
   docker compose logs -f mochi
   ```

## Operations

```bash
# Tail logs (all services, or one)
docker compose logs -f
docker compose logs -f mochi

# Stop / start / restart
docker compose down
docker compose up -d
docker compose restart mochi

# Pull the latest images and recreate by hand (watchtower also does this hourly)
docker compose pull && docker compose up -d
```

### Auto-updates (watchtower)

`watchtower` checks every `3600` seconds (one hour) and recreates any container whose image has a newer build. Since the services track `latest`, Mochi updates itself whenever a new release is published.

A `latest` tag can pull in a breaking change unattended. To stay on a known release, change the `mochi` image tag (for example `:3` or `:3.2.0`) and let watchtower follow that line instead. Note that `watchtower` mounts the Docker socket, which is effectively root on the host.

### Self-healing (autoheal)

`autoheal` is set with `AUTOHEAL_CONTAINER_LABEL: all`, so it watches every container that defines a `HEALTHCHECK` and restarts it when it reports `unhealthy`.

The Mochi image does not define a healthcheck, so autoheal will not restart `mochi` with this configuration. `restart: unless-stopped` still recovers Mochi if the process crashes. To let autoheal catch a hung-but-running bot, add a `healthcheck:` to the `mochi` service. Like watchtower, autoheal mounts the Docker socket.

## Data, backups, and permissions

- `mochi/` holds the SQLite database and the media cache (capped at about 2 GB by default via `CACHE_LIMIT`). Back this directory up to keep guild settings, favorites, and saved state. Reusing it across image upgrades keeps the same bot identity and data.
- `warp/` holds the WARP registration; keeping it avoids re-registering on every restart.
- The container runs as the non-root `bun` user (uid 1000). If you hit permission errors on the bind mounts, make sure `mochi/` and `warp/` are writable by uid 1000 (for example `sudo chown -R 1000:1000 mochi warp`).
