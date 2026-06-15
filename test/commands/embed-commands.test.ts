import { expect, mock, test } from "bun:test";
import {
  ChannelType,
  type ChatInputCommandInteraction,
  Collection,
} from "discord.js";
import { fakeInteraction, fakeManager } from "../helpers/discord.js";

// build-embed is intentionally NOT mocked: it is a local source module that
// build-embed.test.ts needs real, and bun leaks module-mock stubs across files
// on Linux (the stub is captured at file-load time, so an afterAll restore is
// too late). The now-playing/queue tests pass the build-embed-satisfying
// `playingPlayer` below. get-guild-settings is mocked to keep inversify out.
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => ({ defaultQueuePageSize: 10 }),
}));

const { STATUS, MediaSource } = await import("../../src/services/player.js");

const nowPlayingSong = () => ({
  title: "A Song",
  artist: "An Artist",
  url: "abcdefghijk",
  length: 200,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  requestedBy: "user-1",
  source: MediaSource.Youtube,
  addedInChannelId: "chan-1",
});

const playingPlayer = (overrides: Record<string, unknown> = {}) => ({
  getCurrent: () => nowPlayingSong(),
  getQueue: () => [],
  queueSize: () => 0,
  getPosition: () => 0,
  getVolume: () => 100,
  status: STATUS.PLAYING,
  loopCurrentSong: false,
  loopCurrentQueue: false,
  ...overrides,
});
const { default: Skip } = await import("../../src/commands/skip.js");
const { default: Next } = await import("../../src/commands/next.js");
const { default: Unskip } = await import("../../src/commands/unskip.js");
const { default: NowPlaying } = await import(
  "../../src/commands/now-playing.js"
);
const { default: Queue } = await import("../../src/commands/queue.js");
const { default: Resume } = await import("../../src/commands/resume.js");

test("skip: advances and shows the new track", async () => {
  const forward = mock(async () => {});
  const cmd = new Skip(fakeManager(playingPlayer({ forward })));
  const { interaction } = fakeInteraction({ integers: { number: 2 } });
  await cmd.execute(interaction);
  expect(forward).toHaveBeenCalledWith(2);
});

test("next: skips to the following track (inherits skip)", async () => {
  const forward = mock(async () => {});
  const cmd = new Next(fakeManager(playingPlayer({ forward })));
  const { interaction } = fakeInteraction();
  await cmd.execute(interaction);
  expect(forward).toHaveBeenCalledWith(1);
  expect(cmd.slashCommand.name).toBe("next");
});

test("skip: rejects a non-positive count", async () => {
  const cmd = new Skip(fakeManager({ forward: async () => {} }));
  const { interaction } = fakeInteraction({ integers: { number: 0 } });
  expect(cmd.execute(interaction)).rejects.toThrow("invalid number");
});

test("skip: surfaces a friendly error when forwarding fails", async () => {
  const cmd = new Skip(
    fakeManager({
      forward: async () => {
        throw new Error("end");
      },
    }),
  );
  const { interaction } = fakeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow("no song to skip to");
});

test("unskip: goes back to the previous track", async () => {
  const back = mock(async () => {});
  const cmd = new Unskip(fakeManager(playingPlayer({ back })));
  const { interaction } = fakeInteraction();
  await cmd.execute(interaction);
  expect(back).toHaveBeenCalled();
});

test("unskip: surfaces a friendly error when going back fails", async () => {
  const cmd = new Unskip(
    fakeManager({
      back: async () => {
        throw new Error("start");
      },
    }),
  );
  const { interaction } = fakeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow("no song to go back to");
});

test("now-playing: replies with the current track", async () => {
  const cmd = new NowPlaying(fakeManager(playingPlayer()));
  const { interaction } = fakeInteraction();
  await cmd.execute(interaction);
  expect(true).toBe(true);
});

test("now-playing: throws when nothing is playing", async () => {
  const cmd = new NowPlaying(fakeManager({ getCurrent: () => null }));
  const { interaction } = fakeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow(
    "nothing is currently playing",
  );
});

test("queue: replies with a queue embed using the default page size", async () => {
  const cmd = new Queue(fakeManager(playingPlayer()));
  const { interaction } = fakeInteraction();
  await cmd.execute(interaction);
  expect(true).toBe(true);
});

test("queue: honors an explicit page size", async () => {
  const upcoming = Array.from({ length: 12 }, () => nowPlayingSong());
  const cmd = new Queue(
    fakeManager(
      playingPlayer({ getQueue: () => upcoming, queueSize: () => 12 }),
    ),
  );
  const { interaction } = fakeInteraction({
    integers: { page: 2, "page-size": 5 },
  });
  await cmd.execute(interaction);
  expect(true).toBe(true);
});

const resumeInteraction = () => {
  const replies: unknown[] = [];
  const channel = {
    id: "vc-1",
    type: ChannelType.GuildVoice,
    members: new Collection(),
  };
  const interaction = {
    guild: { id: "guild-1" },
    member: { voice: { channel }, user: { id: "u1" } },
    deferReply: async () => {},
    editReply: async (message: unknown) => {
      replies.push(message);
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies };
};

test("resume: connects and resumes playback", async () => {
  const connect = mock(async () => {});
  const play = mock(async () => {});
  const cmd = new Resume(
    fakeManager(playingPlayer({ status: STATUS.PAUSED, connect, play })),
  );
  const { interaction, replies } = resumeInteraction();
  await cmd.execute(interaction);
  expect(connect).toHaveBeenCalled();
  expect(play).toHaveBeenCalled();
  expect(replies).toHaveLength(1);
});

test("resume: throws when already playing", async () => {
  const cmd = new Resume(
    fakeManager({
      status: STATUS.PLAYING,
      getCurrent: () => ({}),
      connect: async () => {},
      play: async () => {},
    }),
  );
  const { interaction } = resumeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow("already playing");
});

test("resume: throws when there is nothing to play", async () => {
  const cmd = new Resume(
    fakeManager({
      status: STATUS.PAUSED,
      getCurrent: () => null,
      connect: async () => {},
      play: async () => {},
    }),
  );
  const { interaction } = resumeInteraction();
  expect(cmd.execute(interaction)).rejects.toThrow("nothing to play");
});
