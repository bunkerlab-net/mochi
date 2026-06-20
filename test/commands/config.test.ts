import { beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { MessageFlags } from "discord.js";
import { eq } from "drizzle-orm";
import { db, runMigrations } from "../../src/db/index.js";
import { setting } from "../../src/db/schema.js";
import { fakeInteraction } from "../helpers/discord.js";

// config imports get-guild-settings (→ events/guild-create → inversify). Mock it
// so only the real db (in-memory) is touched.
let settingsRow: Record<string, unknown>;
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => settingsRow,
}));

// Dynamic import (not static): the mock above must register before config.js and
// its get-guild-settings dependency are evaluated, and a hoisted static import
// would bind the real module first.
const { default: ConfigCmd } = await import("../../src/commands/config.js");

const row = () =>
  db.select().from(setting).where(eq(setting.guildId, "guild-1")).get();

const run = (opts: Parameters<typeof fakeInteraction>[0]) => {
  const { interaction, replies, replyPayloads } = fakeInteraction(opts);
  return {
    promise: new ConfigCmd().execute(interaction),
    replies,
    replyPayloads,
  };
};

beforeAll(() => {
  runMigrations();
});

beforeEach(() => {
  db.delete(setting).where(eq(setting.guildId, "guild-1")).run();
  db.insert(setting).values({ guildId: "guild-1" }).run();
  settingsRow = {
    playlistLimit: 50,
    secondsToWaitAfterQueueEmpties: 0,
    leaveIfNoListeners: true,
    queueAddResponseEphemeral: false,
    autoAnnounceNextSong: false,
    autoplay: true,
    defaultVolume: 100,
    defaultQueuePageSize: 10,
    turnDownVolumeWhenPeopleSpeak: false,
    turnDownVolumeWhenPeopleSpeakTarget: 20,
  };
});

test("set updates an integer setting", async () => {
  await run({
    subcommand: "set",
    strings: { key: "playlist-limit", value: "20" },
  }).promise;
  expect(row()?.playlistLimit).toBe(20);
});

test("set updates a boolean setting from a friendly value", async () => {
  await run({
    subcommand: "set",
    strings: { key: "leave-if-no-listeners", value: "no" },
  }).promise;
  expect(row()?.leaveIfNoListeners).toBe(false);
});

test("set maps each key to its own column", async () => {
  await run({
    subcommand: "set",
    strings: { key: "reduce-vol-when-voice-target", value: "30" },
  }).promise;
  expect(row()?.turnDownVolumeWhenPeopleSpeakTarget).toBe(30);
});

test("set replies ephemerally", async () => {
  const { promise, replyPayloads } = run({
    subcommand: "set",
    strings: { key: "default-volume", value: "50" },
  });
  await promise;
  expect(row()?.defaultVolume).toBe(50);
  expect(replyPayloads[0]).toMatchObject({ flags: MessageFlags.Ephemeral });
});

test("set rejects an out-of-range integer", async () => {
  const { promise } = run({
    subcommand: "set",
    strings: { key: "playlist-limit", value: "0" },
  });
  await expect(promise).rejects.toThrow("at least 1");
});

test("set rejects a non-numeric integer", async () => {
  const { promise } = run({
    subcommand: "set",
    strings: { key: "default-volume", value: "loud" },
  });
  await expect(promise).rejects.toThrow("whole number");
});

test("set rejects an unknown key", async () => {
  const { promise } = run({
    subcommand: "set",
    strings: { key: "bogus", value: "1" },
  });
  await expect(promise).rejects.toThrow("unknown setting");
});

test("get without a key lists every setting, ephemerally", async () => {
  const { promise, replyPayloads } = run({ subcommand: "get" });
  await promise;
  expect(replyPayloads).toHaveLength(1);
  expect(replyPayloads[0]).toMatchObject({ flags: MessageFlags.Ephemeral });
});

test("get with a key shows that setting's detail", async () => {
  const { promise, replyPayloads } = run({
    subcommand: "get",
    strings: { key: "default-volume" },
  });
  await promise;
  expect(replyPayloads).toHaveLength(1);
  expect(replyPayloads[0]).toMatchObject({ flags: MessageFlags.Ephemeral });
});

test("get rejects an unknown key", async () => {
  const { promise } = run({
    subcommand: "get",
    strings: { key: "bogus" },
  });
  await expect(promise).rejects.toThrow("unknown setting");
});

test("throws on an unknown subcommand", async () => {
  const { promise } = run({ subcommand: "bogus" });
  await expect(promise).rejects.toThrow("unknown subcommand");
});
