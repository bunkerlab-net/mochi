import { beforeAll, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";
import { eq } from "drizzle-orm";

// handleGuildCreate builds a REST client to register commands; mock it so no
// network call is made. The real DI container is otherwise safe under test.
mock.module("@discordjs/rest", () => ({
  REST: class {
    setToken() {
      return this;
    }
    async put() {}
  },
}));

// inversify.config first to avoid the bot.ts <-> inversify.config TDZ.
const { default: container } = await import("../../src/inversify.config.js");
const { default: handleGuildCreate, createGuildSettings } = await import(
  "../../src/events/guild-create.js"
);
const { db, runMigrations } = await import("../../src/db/index.js");
const { setting } = await import("../../src/db/schema.js");
const { TYPES } = await import("../../src/types.js");

const client = () => container.get(TYPES.Client) as Client;

beforeAll(() => {
  runMigrations();
});

test("createGuildSettings inserts and returns default settings", async () => {
  db.delete(setting).where(eq(setting.guildId, "gc-1")).run();
  const row = await createGuildSettings("gc-1");
  expect(row.playlistLimit).toBe(50);
  expect(row.autoplay).toBe(true);
});

test("createGuildSettings is idempotent", async () => {
  await createGuildSettings("gc-1");
  const row = await createGuildSettings("gc-1");
  expect(row.guildId).toBe("gc-1");
});

test("handler throws when the client is not ready", async () => {
  (client() as unknown as { user: unknown }).user = null;
  const guild = {
    id: "gc-2",
    fetchOwner: async () => ({ send: async () => {} }),
  };
  expect(handleGuildCreate(guild as never)).rejects.toThrow(
    "Client is not ready",
  );
});

test("handler registers commands and DMs the owner", async () => {
  (client() as unknown as { user: unknown }).user = { id: "bot-1" };
  const send = mock(async () => {});
  const guild = { id: "gc-3", fetchOwner: async () => ({ send }) };
  await handleGuildCreate(guild as never);
  expect(send).toHaveBeenCalled();
});
