import { beforeAll, expect, mock, test } from "bun:test";
import { VoiceConnectionStatus } from "@discordjs/voice";
import { Collection } from "discord.js";

// The handler reads leaveIfNoListeners from get-guild-settings. Pin it to a
// fixed value so the disconnect logic is deterministic regardless of any leaked
// get-guild-settings stub from another file (bun doesn't reliably reset module
// mocks between files, notably on Linux).
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => ({ leaveIfNoListeners: true }),
}));

// inversify.config first to avoid the bot.ts <-> inversify.config TDZ.
const { default: container } = await import("../../src/inversify.config.js");
const { default: handleVoiceStateUpdate } = await import(
  "../../src/events/voice-state-update.js"
);
const { runMigrations } = await import("../../src/db/index.js");
const { TYPES } = await import("../../src/types.js");

type Player = {
  voiceConnection: unknown;
  guildId: string;
  disconnect: () => void;
};

const playerFor = (guildId: string) =>
  (container.get(TYPES.Managers.Player) as { get: (id: string) => Player }).get(
    guildId,
  );

const connection = (channelId: string | null) => ({
  state: { status: VoiceConnectionStatus.Ready },
  joinConfig: { channelId },
  destroy: () => {},
});

const voiceChannel = (members: Array<{ user: { bot: boolean } }>) => ({
  members: new Collection(members.map((m, i) => [String(i), m])),
});

const state = (
  guildId: string,
  channelId: string | null,
  channels = new Collection(),
) =>
  ({
    guild: { id: guildId, channels: { cache: channels } },
    channelId,
  }) as never;

beforeAll(() => {
  runMigrations();
});

test("returns early when there is no active voice connection", async () => {
  const player = playerFor("vs-early");
  player.voiceConnection = null;
  await expect(
    handleVoiceStateUpdate(state("vs-early", "vc"), state("vs-early", null)),
  ).resolves.toBeUndefined();
});

test("disconnects when the channel has no human listeners", async () => {
  const player = playerFor("vs-disc");
  player.voiceConnection = connection("vc-1");
  const channels = new Collection([["vc-1", voiceChannel([])]]);
  await handleVoiceStateUpdate(
    state("vs-disc", "vc-1"),
    state("vs-disc", null, channels),
  );
  expect(player.voiceConnection).toBeNull();
});

test("does nothing when the change is for an unrelated channel", async () => {
  const player = playerFor("vs-other");
  player.voiceConnection = connection("vc-1");
  await handleVoiceStateUpdate(
    state("vs-other", "other"),
    state("vs-other", "other"),
  );
  expect(player.voiceConnection).not.toBeNull();
});

test("stays connected when humans remain in the channel", async () => {
  const player = playerFor("vs-busy");
  player.voiceConnection = connection("vc-1");
  const channels = new Collection([
    ["vc-1", voiceChannel([{ user: { bot: false } }])],
  ]);
  await handleVoiceStateUpdate(
    state("vs-busy", "vc-1"),
    state("vs-busy", null, channels),
  );
  expect(player.voiceConnection).not.toBeNull();
});
