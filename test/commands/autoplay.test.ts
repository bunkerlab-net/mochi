import { beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, runMigrations } from "../../src/db/index.js";
import { setting } from "../../src/db/schema.js";
import { fakeInteraction } from "../helpers/discord.js";

let settingsRow: Record<string, unknown>;
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => settingsRow,
}));

const { default: AutoplayCmd } = await import("../../src/commands/autoplay.js");

const row = () =>
  db.select().from(setting).where(eq(setting.guildId, "guild-1")).get();

beforeAll(() => {
  runMigrations();
});

beforeEach(() => {
  db.delete(setting).where(eq(setting.guildId, "guild-1")).run();
  db.insert(setting).values({ guildId: "guild-1" }).run();
});

test("turns autoplay on when it was off", async () => {
  settingsRow = { autoplay: false };
  const { interaction, replies } = fakeInteraction();
  await new AutoplayCmd().execute(interaction);
  expect(row()?.autoplay).toBe(true);
  expect(replies[0]).toContain("autoplay on");
});

test("turns autoplay off when it was on", async () => {
  settingsRow = { autoplay: true };
  const { interaction, replies } = fakeInteraction();
  await new AutoplayCmd().execute(interaction);
  expect(row()?.autoplay).toBe(false);
  expect(replies[0]).toContain("autoplay off");
});
