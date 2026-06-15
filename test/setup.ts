// Test preload: runs before any test module loads. Establishes a deterministic
// environment so modules that read process.env at import time
// (src/services/config.ts) and the SQLite layer (src/db/index.ts) behave the
// same on every machine and in CI — independent of the developer's real .env or
// any exported shell variables.
//
// These values OVERRIDE the ambient environment on purpose: tests own their
// environment. `DATABASE_URL=file::memory:` makes src/db use an in-memory
// SQLite database, so tests never touch the filesystem. ENV_FILE points dotenv
// at an empty fixture so the real .env is never loaded.

const env: Record<string, string> = {
  ENV_FILE: `${import.meta.dir}/fixtures/empty.env`,
  DATABASE_URL: "file::memory:",
  LOG_LEVEL: "silent",
  // Required by config.ts (a missing value calls process.exit(1)).
  DISCORD_TOKEN: "test-discord-token",
  YOUTUBE_API_KEY: "test-youtube-key",
  // Optional config values, pinned so config.test.ts is hermetic.
  SPOTIFY_CLIENT_ID: "",
  SPOTIFY_CLIENT_SECRET: "",
  LASTFM_API_KEY: "",
  REGISTER_COMMANDS_ON_BOT: "false",
  CACHE_LIMIT: "2GB",
  BOT_STATUS: "online",
  BOT_ACTIVITY_TYPE: "LISTENING",
  BOT_ACTIVITY_URL: "",
  BOT_ACTIVITY: "music",
  ENABLE_SPONSORBLOCK: "false",
  SPONSORBLOCK_TIMEOUT: "5",
  YT_DLP_AUTO_UPDATE: "false",
};

for (const [key, value] of Object.entries(env)) {
  process.env[key] = value;
}

// Clear vars that would otherwise shift config defaults under test.
delete process.env["YT_DLP_PATH"];
delete process.env["MOCHI_BUNDLED_YT_DLP_PATH"];
delete process.env["DATA_DIR"];
