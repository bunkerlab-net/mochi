import { expect, mock, test } from "bun:test";
import { fakeInteraction, fakeManager } from "../helpers/discord.js";

// These commands import STATUS from player.ts, which transitively reaches the
// DI container via get-guild-settings; mock it to keep inversify out.
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => ({}),
}));

const { STATUS } = await import("../../src/services/player.js");
const { default: Pause } = await import("../../src/commands/pause.js");
const { default: Stop } = await import("../../src/commands/stop.js");
const { default: Loop } = await import("../../src/commands/loop.js");
const { default: LoopQueue } = await import("../../src/commands/loop-queue.js");

test("pause: pauses a playing track", async () => {
  const pause = mock(() => {});
  const cmd = new Pause(fakeManager({ status: STATUS.PLAYING, pause }));
  const { interaction, replies } = fakeInteraction();
  await cmd.execute(interaction);
  expect(pause).toHaveBeenCalled();
  expect(replies[0]).toContain("red");
});

test("pause: throws when not playing", async () => {
  const cmd = new Pause(
    fakeManager({ status: STATUS.PAUSED, pause: () => {} }),
  );
  const { interaction } = fakeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow("not currently playing");
});

test("stop: stops an active, playing connection", async () => {
  const stop = mock(() => {});
  const cmd = new Stop(
    fakeManager({ voiceConnection: {}, status: STATUS.PLAYING, stop }),
  );
  const { interaction, replies } = fakeInteraction();
  await cmd.execute(interaction);
  expect(stop).toHaveBeenCalled();
  expect(replies[0]).toContain("stopped");
});

test("stop: throws when not connected", async () => {
  const cmd = new Stop(
    fakeManager({
      voiceConnection: null,
      status: STATUS.PLAYING,
      stop: () => {},
    }),
  );
  const { interaction } = fakeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow("not connected");
});

test("stop: throws when not playing", async () => {
  const cmd = new Stop(
    fakeManager({ voiceConnection: {}, status: STATUS.PAUSED, stop: () => {} }),
  );
  const { interaction } = fakeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow("not currently playing");
});

test("loop: enables looping the current song", async () => {
  const player = {
    status: STATUS.PLAYING,
    loopCurrentSong: false,
    loopCurrentQueue: true,
  };
  const cmd = new Loop(fakeManager(player));
  const { interaction, replies } = fakeInteraction();
  await cmd.execute(interaction);
  expect(player.loopCurrentSong).toBe(true);
  expect(player.loopCurrentQueue).toBe(false);
  expect(replies[0]).toContain("looped");
});

test("loop: throws when idle", async () => {
  const cmd = new Loop(fakeManager({ status: STATUS.IDLE }));
  const { interaction } = fakeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow("no song to loop");
});

test("loop-queue: enables looping the queue", async () => {
  const player = {
    status: STATUS.PLAYING,
    queueSize: () => 3,
    loopCurrentSong: true,
    loopCurrentQueue: false,
  };
  const cmd = new LoopQueue(fakeManager(player));
  const { interaction, replies } = fakeInteraction();
  await cmd.execute(interaction);
  expect(player.loopCurrentQueue).toBe(true);
  expect(player.loopCurrentSong).toBe(false);
  expect(replies[0]).toContain("looped queue");
});

test("loop-queue: throws when idle", async () => {
  const cmd = new LoopQueue(
    fakeManager({ status: STATUS.IDLE, queueSize: () => 5 }),
  );
  const { interaction } = fakeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow("no songs to loop");
});

test("loop-queue: throws when there are too few songs", async () => {
  const cmd = new LoopQueue(
    fakeManager({ status: STATUS.PLAYING, queueSize: () => 1 }),
  );
  const { interaction } = fakeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow("not enough songs");
});
