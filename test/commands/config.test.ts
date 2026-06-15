import { beforeAll, beforeEach, expect, mock, test } from "bun:test";
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

const { default: ConfigCmd } = await import("../../src/commands/config.js");

const row = () =>
  db.select().from(setting).where(eq(setting.guildId, "guild-1")).get();

const run = (opts: Parameters<typeof fakeInteraction>[0]) => {
  const { interaction, replies } = fakeInteraction(opts);
  return { promise: new ConfigCmd().execute(interaction), replies };
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
    autoAnnounceNextSong: false,
    autoplay: true,
    queueAddResponseEphemeral: false,
    defaultVolume: 100,
    defaultQueuePageSize: 10,
    turnDownVolumeWhenPeopleSpeak: false,
  };
});

test("set-playlist-limit updates the row", async () => {
  await run({ subcommand: "set-playlist-limit", integers: { limit: 20 } })
    .promise;
  expect(row()?.playlistLimit).toBe(20);
});

test("set-playlist-limit rejects a limit below 1", async () => {
  const { promise } = run({
    subcommand: "set-playlist-limit",
    integers: { limit: 0 },
  });
  expect(promise).rejects.toThrow("invalid limit");
});

test("set-wait-after-queue-empties updates the row", async () => {
  await run({
    subcommand: "set-wait-after-queue-empties",
    integers: { delay: 45 },
  }).promise;
  expect(row()?.secondsToWaitAfterQueueEmpties).toBe(45);
});

test("set-leave-if-no-listeners updates the row", async () => {
  await run({
    subcommand: "set-leave-if-no-listeners",
    booleans: { value: false },
  }).promise;
  expect(row()?.leaveIfNoListeners).toBe(false);
});

test("set-queue-add-response-hidden updates the row", async () => {
  await run({
    subcommand: "set-queue-add-response-hidden",
    booleans: { value: true },
  }).promise;
  expect(row()?.queueAddResponseEphemeral).toBe(true);
});

test("set-auto-announce-next-song updates the row", async () => {
  await run({
    subcommand: "set-auto-announce-next-song",
    booleans: { value: true },
  }).promise;
  expect(row()?.autoAnnounceNextSong).toBe(true);
});

test("set-default-volume updates the row", async () => {
  await run({ subcommand: "set-default-volume", integers: { level: 50 } })
    .promise;
  expect(row()?.defaultVolume).toBe(50);
});

test("set-default-queue-page-size updates the row", async () => {
  await run({
    subcommand: "set-default-queue-page-size",
    integers: { "page-size": 20 },
  }).promise;
  expect(row()?.defaultQueuePageSize).toBe(20);
});

test("set-reduce-vol-when-voice updates the row", async () => {
  await run({
    subcommand: "set-reduce-vol-when-voice",
    booleans: { value: true },
  }).promise;
  expect(row()?.turnDownVolumeWhenPeopleSpeak).toBe(true);
});

test("set-reduce-vol-when-voice-target updates the row", async () => {
  await run({
    subcommand: "set-reduce-vol-when-voice-target",
    integers: { volume: 30 },
  }).promise;
  expect(row()?.turnDownVolumeWhenPeopleSpeakTarget).toBe(30);
});

test("get: replies with a settings embed", async () => {
  const { promise, replies } = run({ subcommand: "get" });
  await promise;
  expect(replies).toHaveLength(1);
});

test("throws on an unknown subcommand", async () => {
  const { promise } = run({ subcommand: "bogus" });
  expect(promise).rejects.toThrow("unknown subcommand");
});
