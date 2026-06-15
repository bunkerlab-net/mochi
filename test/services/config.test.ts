import { expect, test } from "bun:test";
import { ActivityType } from "discord.js";
import Config from "../../src/services/config.js";

// Env defaults come from test/setup.ts (the preload). config.ts freezes its
// CONFIG_MAP at import time, so these assertions reflect that environment.

test("reads required string values from the environment", () => {
  const config = new Config();
  expect(config.DISCORD_TOKEN).toBe("test-discord-token");
  expect(config.YOUTUBE_API_KEY).toBe("test-youtube-key");
});

test("applies defaults for unset optional string values", () => {
  const config = new Config();
  expect(config.SPOTIFY_CLIENT_ID).toBe("");
  expect(config.LASTFM_API_KEY).toBe("");
  expect(config.BOT_ACTIVITY).toBe("music");
});

test("coerces boolean-style env vars", () => {
  const config = new Config();
  expect(config.REGISTER_COMMANDS_ON_BOT).toBe(false);
  expect(config.ENABLE_SPONSORBLOCK).toBe(false);
  expect(config.YT_DLP_AUTO_UPDATE).toBe(false);
});

test("parses numeric values", () => {
  const config = new Config();
  expect(config.SPONSORBLOCK_TIMEOUT).toBe(5);
  expect(config.CACHE_LIMIT_IN_BYTES).toBe(2_000_000_000);
  expect(Number.isFinite(config.CACHE_LIMIT_IN_BYTES)).toBe(true);
});

test("maps BOT_ACTIVITY_TYPE to a discord.js ActivityType", () => {
  const config = new Config();
  expect(config.BOT_ACTIVITY_TYPE).toBe(ActivityType.Listening);
});

test("defaults YT_DLP_PATH to the bare binary name", () => {
  const config = new Config();
  expect(config.YT_DLP_PATH).toBe("yt-dlp");
});

test("derives CACHE_DIR from DATA_DIR", () => {
  const config = new Config();
  expect(config.CACHE_DIR.endsWith("/cache")).toBe(true);
  expect(config.CACHE_DIR.startsWith(config.DATA_DIR)).toBe(true);
});
