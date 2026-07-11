import { beforeEach, expect, mock, test } from "bun:test";
import {
  ChannelType,
  type ChatInputCommandInteraction,
  Collection,
} from "discord.js";

// add-query imports get-guild-settings (→ player → DI); mock it to keep
// inversify out of the graph. build-embed is intentionally NOT mocked: it is a
// local source module that build-embed.test.ts needs real, and bun leaks
// module-mock stubs across files on Linux (the stub is captured at file-load
// time, so an afterAll restore is too late). The fake player below satisfies
// the real build-embed.
let settings: Record<string, unknown> = {};
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => settings,
}));

const { default: AddQueryToQueue } = await import(
  "../../src/services/add-query-to-queue.js"
);
const { MediaSource, STATUS } = await import("../../src/services/player.js");

const song = (overrides: Record<string, unknown> = {}) => ({
  source: MediaSource.Youtube,
  title: "Song",
  artist: "A",
  url: "vid",
  length: 100,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  ...overrides,
});

const fakePlayer = (overrides: Record<string, unknown> = {}) => {
  // A stable current song so the identity-based skip check sees the same object
  // before and after enqueue, and so the real buildPlayingMessageEmbed (called
  // from connectAndPlay) has something to render.
  const current = song();
  return {
    getCurrent: () => current,
    getQueue: () => [],
    queueSize: () => 0,
    getPosition: () => 0,
    getVolume: () => 100,
    loopCurrentSong: false,
    loopCurrentQueue: false,
    voiceConnection: null,
    status: STATUS.PLAYING,
    connect: mock(async () => {}),
    play: mock(async () => {}),
    forward: mock(async () => {}),
    add: mock(() => {}),
    ...overrides,
  };
};

const make = (opts: {
  getSongs: () => Promise<unknown>;
  player: unknown;
  sponsorblock?: boolean;
  wrap?: (f: () => unknown) => Promise<unknown>;
}) =>
  new AddQueryToQueue(
    { getSongs: opts.getSongs } as never,
    { get: () => opts.player } as never,
    {
      SPONSORBLOCK_TIMEOUT: 5,
      ENABLE_SPONSORBLOCK: opts.sponsorblock ?? false,
    } as never,
    { wrap: opts.wrap ?? (async (f: () => unknown) => f()) } as never,
  );

const interaction = () => {
  const replies: unknown[] = [];
  const deferArgs: unknown[] = [];
  const channel = {
    id: "vc",
    type: ChannelType.GuildVoice,
    members: new Collection(),
  };
  const obj = {
    guild: { id: "g" },
    member: { voice: { channel }, user: { id: "u" } },
    channelId: "text",
    deferReply: async (a: unknown) => {
      deferArgs.push(a);
    },
    editReply: async (m: unknown) => {
      replies.push(m);
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction: obj, replies, deferArgs };
};

const baseArgs = {
  query: "q",
  addToFrontOfQueue: false,
  shuffleAdditions: false,
  shouldSplitChapters: false,
  skipCurrentTrack: false,
};

beforeEach(() => {
  settings = { playlistLimit: 50, queueAddResponseEphemeral: false };
});

test("adds a single song, connects, and replies", async () => {
  const player = fakePlayer();
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i, replies } = interaction();
  await cmd.addToQueue({ ...baseArgs, interaction: i });
  expect(player.add).toHaveBeenCalled();
  expect(player.connect).toHaveBeenCalled();
  expect(player.play).toHaveBeenCalled();
  expect(replies.at(-1)).toContain("added to the");
});

test("throws when no songs are found", async () => {
  const cmd = make({ getSongs: async () => [[], ""], player: fakePlayer() });
  const { interaction: i } = interaction();
  expect(cmd.addToQueue({ ...baseArgs, interaction: i })).rejects.toThrow(
    "no songs found",
  );
});

test("reports the count when multiple songs are added", async () => {
  const cmd = make({
    getSongs: async () => [[song(), song({ url: "v2" })], ""],
    player: fakePlayer(),
  });
  const { interaction: i, replies } = interaction();
  await cmd.addToQueue({ ...baseArgs, interaction: i });
  expect(replies.at(-1)).toContain("1 other songs");
});

test("adds to the front of the queue when requested", async () => {
  const player = fakePlayer();
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i, replies } = interaction();
  await cmd.addToQueue({
    ...baseArgs,
    addToFrontOfQueue: true,
    interaction: i,
  });
  expect(player.add).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ immediate: true }),
  );
  expect(replies.at(-1)).toContain("front of the");
});

test("skips the current track when requested", async () => {
  const player = fakePlayer();
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i } = interaction();
  await cmd.addToQueue({ ...baseArgs, skipCurrentTrack: true, interaction: i });
  expect(player.forward).toHaveBeenCalledWith(1);
});

test("surfaces the real error when the skipped-to track fails to play", async () => {
  const player = fakePlayer({
    forward: async () => {
      throw new Error("yt-dlp failed to extract media: video unavailable");
    },
  });
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i } = interaction();
  await expect(
    cmd.addToQueue({ ...baseArgs, skipCurrentTrack: true, interaction: i }),
  ).rejects.toThrow("yt-dlp failed to extract media");
});

test("reports the skip in the reply when a track was playing", async () => {
  const player = fakePlayer();
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i, replies } = interaction();
  await cmd.addToQueue({ ...baseArgs, skipCurrentTrack: true, interaction: i });
  expect(String(replies.at(-1))).toContain(" and current track skipped");
  expect(player.forward).toHaveBeenCalledWith(1);
});

test("does not skip when nothing was playing before enqueue", async () => {
  const player = fakePlayer({
    getCurrent: () => null,
    voiceConnection: {},
    status: STATUS.IDLE,
  });
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i, replies } = interaction();
  await cmd.addToQueue({ ...baseArgs, skipCurrentTrack: true, interaction: i });
  expect(player.forward).not.toHaveBeenCalled();
  expect(String(replies.at(-1))).not.toContain("skipped");
});

test("skips to the requested track when the current one is loaded but idle", async () => {
  const player = fakePlayer({ voiceConnection: {}, status: STATUS.IDLE });
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i, replies } = interaction();
  await cmd.addToQueue({ ...baseArgs, skipCurrentTrack: true, interaction: i });
  expect(player.forward).toHaveBeenCalledWith(1);
  expect(String(replies.at(-1))).toContain(" and current track skipped");
});

test("does not skip when the current track changed during song resolution", async () => {
  const songA = song({ url: "a" });
  const songB = song({ url: "b" });
  let calls = 0;
  const player = fakePlayer({
    voiceConnection: {},
    status: STATUS.PLAYING,
    // Track A when we capture before enqueue, track B at the skip decision:
    // the previous track ended and the queue advanced while resolving songs.
    getCurrent: () => {
      calls += 1;
      return calls === 1 ? songA : songB;
    },
  });
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i, replies } = interaction();
  await cmd.addToQueue({ ...baseArgs, skipCurrentTrack: true, interaction: i });
  expect(player.forward).not.toHaveBeenCalled();
  expect(String(replies.at(-1))).not.toContain("skipped");
});

test("front insertion keeps a multi-song batch in requested order", async () => {
  const added: string[] = [];
  const player = fakePlayer({
    voiceConnection: {},
    add: mock((s: { url: string }) => {
      added.push(s.url);
    }),
  });
  const cmd = make({
    getSongs: async () => [[song({ url: "s1" }), song({ url: "s2" })], ""],
    player,
  });
  const { interaction: i } = interaction();
  await cmd.addToQueue({
    ...baseArgs,
    addToFrontOfQueue: true,
    interaction: i,
  });
  // Inserted back-to-front so a real player's front insert yields s1, s2.
  expect(added).toEqual(["s2", "s1"]);
});

test("starts playback when already connected but idle", async () => {
  const player = fakePlayer({ voiceConnection: {}, status: STATUS.IDLE });
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i } = interaction();
  await cmd.addToQueue({ ...baseArgs, interaction: i });
  expect(player.play).toHaveBeenCalled();
  expect(player.connect).not.toHaveBeenCalled();
});

test("notes resuming playback when a song was already queued", async () => {
  const player = fakePlayer({ getCurrent: () => song() });
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i, replies } = interaction();
  await cmd.addToQueue({ ...baseArgs, interaction: i });
  expect(replies.at(-1)).toContain("resuming playback");
});

test("defers ephemerally when the guild setting is on", async () => {
  settings = { playlistLimit: 50, queueAddResponseEphemeral: true };
  const cmd = make({
    getSongs: async () => [[song()], ""],
    player: fakePlayer(),
  });
  const { interaction: i, deferArgs } = interaction();
  await cmd.addToQueue({ ...baseArgs, interaction: i });
  expect(deferArgs[0]).toMatchObject({ flags: expect.anything() });
});

test("shuffles additions without error", async () => {
  const cmd = make({
    getSongs: async () => [[song(), song({ url: "v2" })], ""],
    player: fakePlayer(),
  });
  const { interaction: i } = interaction();
  await cmd.addToQueue({ ...baseArgs, shuffleAdditions: true, interaction: i });
  expect(true).toBe(true);
});

// ---- SponsorBlock segment handling ----------------------------------------
const sbCmd = (
  segments: unknown,
  wrap?: (f: () => unknown) => Promise<unknown>,
) => {
  const cmd = make({
    getSongs: async () => [[], ""],
    player: fakePlayer(),
    sponsorblock: true,
    wrap: wrap ?? (async (f: () => unknown) => f()),
  });
  (cmd as unknown as { sponsorBlock: unknown }).sponsorBlock = {
    getSegments: async () => segments,
  };
  return cmd;
};

test("skipNonMusicSegments: applies intro and outro offsets", async () => {
  const cmd = sbCmd([
    { startTime: 0, endTime: 3 },
    { startTime: 96, endTime: 100 },
  ]);
  const result = (await (
    cmd as unknown as {
      skipNonMusicSegments: (
        s: unknown,
      ) => Promise<{ offset: number; length: number }>;
    }
  ).skipNonMusicSegments(song({ length: 100 }))) as {
    offset: number;
    length: number;
  };
  expect(result.offset).toBe(3);
  expect(result.length).toBeLessThan(100);
});

test("skipNonMusicSegments: merges overlapping segments", async () => {
  const cmd = sbCmd([
    { startTime: 0, endTime: 5 },
    { startTime: 3, endTime: 8 },
  ]);
  const result = (await (
    cmd as unknown as {
      skipNonMusicSegments: (s: unknown) => Promise<{ offset: number }>;
    }
  ).skipNonMusicSegments(song({ length: 100 }))) as { offset: number };
  expect(result.offset).toBe(8);
});

test("skipNonMusicSegments: leaves non-YouTube songs untouched", async () => {
  const cmd = sbCmd([{ startTime: 0, endTime: 3 }]);
  const input = song({ source: MediaSource.HLS });
  const result = await (
    cmd as unknown as { skipNonMusicSegments: (s: unknown) => Promise<unknown> }
  ).skipNonMusicSegments(input);
  expect(result).toBe(input);
});

test("skipNonMusicSegments: swallows a 404 (no segments)", async () => {
  const cmd = sbCmd(undefined, async () => {
    throw new Error("Request failed: 404");
  });
  const input = song();
  const result = await (
    cmd as unknown as { skipNonMusicSegments: (s: unknown) => Promise<unknown> }
  ).skipNonMusicSegments(input);
  expect(result).toBe(input);
});

test("skipNonMusicSegments: disables SponsorBlock on a 504", async () => {
  const cmd = sbCmd(undefined, async () => {
    throw new Error("Gateway timeout: 504");
  });
  await (
    cmd as unknown as { skipNonMusicSegments: (s: unknown) => Promise<unknown> }
  ).skipNonMusicSegments(song());
  expect(
    (cmd as unknown as { sponsorBlockDisabledUntil?: Date })
      .sponsorBlockDisabledUntil,
  ).toBeInstanceOf(Date);
});

test("skipNonMusicSegments: tolerates a non-Error rejection", async () => {
  const cmd = sbCmd(undefined, async () => {
    throw "string failure";
  });
  const input = song();
  const result = await (
    cmd as unknown as { skipNonMusicSegments: (s: unknown) => Promise<unknown> }
  ).skipNonMusicSegments(input);
  expect(result).toBe(input);
});
