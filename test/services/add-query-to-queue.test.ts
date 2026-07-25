import { beforeEach, expect, mock, test } from "bun:test";
import {
  ChannelType,
  type ChatInputCommandInteraction,
  Collection,
} from "discord.js";
import { NoNextTrackError } from "../../src/utils/errors.js";

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
  autoplay?: unknown;
}) =>
  new AddQueryToQueue(
    { getSongs: opts.getSongs } as never,
    { get: () => opts.player } as never,
    {
      SPONSORBLOCK_TIMEOUT: 5,
      ENABLE_SPONSORBLOCK: opts.sponsorblock ?? false,
    } as never,
    { wrap: opts.wrap ?? (async (f: () => unknown) => f()) } as never,
    (opts.autoplay ?? { getYouTubeMixSongs: async () => [] }) as never,
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
  queueMix: false,
  sessionAutoplay: null,
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

test("reports a friendly error when the skip target vanished", async () => {
  const player = fakePlayer({
    forward: async () => {
      throw new NoNextTrackError();
    },
  });
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i } = interaction();
  await expect(
    cmd.addToQueue({ ...baseArgs, skipCurrentTrack: true, interaction: i }),
  ).rejects.toThrow("no song to skip to");
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

// A fake player whose add() models real front-insertion vs append semantics so
// tests can assert the resulting queue order, not raw add-call order.
const statefulQueuePlayer = () => {
  const queue = ["current"];
  const player = fakePlayer({
    voiceConnection: {},
    getCurrent: () => ({ ...song(), url: queue[0] }),
    add: (
      s: { url: string; playlist?: unknown },
      opts?: { immediate?: boolean },
    ) => {
      if (s.playlist || !opts?.immediate) {
        queue.push(s.url);
      } else {
        queue.splice(1, 0, s.url);
      }
    },
  });
  return { player, queue };
};

test("front insertion inserts a multi-song batch after the current track in order", async () => {
  const { player, queue } = statefulQueuePlayer();
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
  expect(queue).toEqual(["current", "s1", "s2"]);
});

test("front insertion appends a playlist batch in original order", async () => {
  const { player, queue } = statefulQueuePlayer();
  const playlist = { title: "p", source: "s" };
  const cmd = make({
    getSongs: async () => [
      [song({ url: "p1", playlist }), song({ url: "p2", playlist })],
      "",
    ],
    player,
  });
  const { interaction: i } = interaction();
  await cmd.addToQueue({
    ...baseArgs,
    addToFrontOfQueue: true,
    interaction: i,
  });
  // Playlist songs always append (add ignores immediate for them).
  expect(queue).toEqual(["current", "p1", "p2"]);
});

test("front insertion reports the front-of-queue qualifier for multiple songs", async () => {
  const player = fakePlayer({ voiceConnection: {} });
  const cmd = make({
    getSongs: async () => [[song(), song({ url: "v2" })], ""],
    player,
  });
  const { interaction: i, replies } = interaction();
  await cmd.addToQueue({
    ...baseArgs,
    addToFrontOfQueue: true,
    interaction: i,
  });
  expect(String(replies.at(-1))).toContain("other songs");
  expect(String(replies.at(-1))).toContain("front of the");
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

// ---- mix ------------------------------------------------------------------
const seedSong = song({ url: "AAAAAAAAAAA", title: "Seed" });

test("mix: queues the seed track followed by its mix", async () => {
  let received: { limit: number; exclude: Set<string> } | undefined;
  const player = fakePlayer({
    getCurrent: () => song({ url: "playing0000" }),
    getQueue: () => [song({ url: "queued00000" })],
  });
  const cmd = make({
    getSongs: async () => [[seedSong], ""],
    player,
    autoplay: {
      getYouTubeMixSongs: async (
        _seed: unknown,
        opts: { limit: number; exclude: Set<string> },
      ) => {
        received = opts;
        return [song({ url: "BBBBBBBBBBB" }), song({ url: "CCCCCCCCCCC" })];
      },
    },
  });
  const { interaction: i } = interaction();

  await cmd.addToQueue({ ...baseArgs, queueMix: true, interaction: i });

  expect(player.add).toHaveBeenCalledTimes(3);
  // The seed takes one of the limit's slots.
  expect(received?.limit).toBe(49);
  // getQueue() omits the playing track, so it has to be excluded separately.
  expect([...(received?.exclude ?? [])]).toEqual([
    "AAAAAAAAAAA",
    "playing0000",
    "queued00000",
  ]);
});

test("mix: keeps only the first track of a multi-track query", async () => {
  const player = fakePlayer();
  const cmd = make({
    getSongs: async () => [[seedSong, song({ url: "second00000" })], ""],
    player,
    autoplay: {
      getYouTubeMixSongs: async () => [song({ url: "BBBBBBBBBBB" })],
    },
  });
  const { interaction: i, replies } = interaction();

  await cmd.addToQueue({ ...baseArgs, queueMix: true, interaction: i });

  expect(player.add).toHaveBeenCalledTimes(2);
  const added = player.add.mock.calls.map(
    (call) => (call[0] as { url: string }).url,
  );
  expect(added).toEqual(["AAAAAAAAAAA", "BBBBBBBBBBB"]);
  expect(replies.at(-1)).toContain("a mix seeded by");
});

test("mix: reports that only YouTube tracks have mixes", async () => {
  const player = fakePlayer();
  const cmd = make({
    getSongs: async () => [
      [song({ source: MediaSource.SoundCloud, url: "https://sc/track" })],
      "",
    ],
    player,
  });
  const { interaction: i, replies } = interaction();

  await cmd.addToQueue({ ...baseArgs, queueMix: true, interaction: i });

  expect(player.add).toHaveBeenCalledTimes(1);
  expect(replies.at(-1)).toContain("only available for YouTube");
});

test("mix: collapses to the seed when the playlist limit leaves no room", async () => {
  settings = { playlistLimit: 1, queueAddResponseEphemeral: false };
  const player = fakePlayer();
  const cmd = make({
    getSongs: async () => [[seedSong, song({ url: "second00000" })], ""],
    player,
  });
  const { interaction: i, replies } = interaction();

  await cmd.addToQueue({ ...baseArgs, queueMix: true, interaction: i });

  // The cap is deliberate, so the request collapses to its seed rather than
  // queueing the untouched input past the limit.
  expect(player.add).toHaveBeenCalledTimes(1);
  expect(replies.at(-1)).toContain("left no room for a mix");
});

test("mix: reports when the track has no mix", async () => {
  const cmd = make({
    getSongs: async () => [[seedSong], ""],
    player: fakePlayer(),
  });
  const { interaction: i, replies } = interaction();

  await cmd.addToQueue({ ...baseArgs, queueMix: true, interaction: i });

  expect(replies.at(-1)).toContain("no mix was found");
});

// ---- session autoplay override --------------------------------------------
test("session autoplay: applies an explicit override to the player", async () => {
  const player = fakePlayer({ sessionAutoplay: null });
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i } = interaction();

  await cmd.addToQueue({ ...baseArgs, sessionAutoplay: false, interaction: i });

  expect(player.sessionAutoplay).toBe(false);
});

test("session autoplay: omitting it keeps the guild setting in charge", async () => {
  const player = fakePlayer({ sessionAutoplay: null });
  const cmd = make({ getSongs: async () => [[song()], ""], player });
  const { interaction: i } = interaction();

  await cmd.addToQueue({ ...baseArgs, interaction: i });

  expect(player.sessionAutoplay).toBeNull();
});

test("session autoplay: an override survives later requests that omit it", async () => {
  const player = fakePlayer({ sessionAutoplay: null });
  const cmd = make({ getSongs: async () => [[song()], ""], player });

  await cmd.addToQueue({
    ...baseArgs,
    sessionAutoplay: false,
    interaction: interaction().interaction,
  });
  await cmd.addToQueue({ ...baseArgs, interaction: interaction().interaction });

  // The override is scoped to the session, not to the one request that set it,
  // so only an explicit true/false (or the session ending) changes it.
  expect(player.sessionAutoplay).toBe(false);
});

test("mix: drops a resolution notice that no longer describes the queue", async () => {
  const player = fakePlayer();
  const cmd = make({
    // What a capped channel query looks like: several tracks plus a notice.
    getSongs: async () => [
      [seedSong, song({ url: "second00000" })],
      "only the first 2 tracks were added",
    ],
    player,
    autoplay: {
      getYouTubeMixSongs: async () => [song({ url: "BBBBBBBBBBB" })],
    },
  });
  const { interaction: i, replies } = interaction();

  await cmd.addToQueue({ ...baseArgs, queueMix: true, interaction: i });

  const reply = replies.at(-1) as string;
  expect(reply).toContain("a mix seeded by");
  expect(reply).not.toContain("only the first");
});

test("mix: keeps a resolution notice when no mix could be built", async () => {
  const cmd = make({
    getSongs: async () => [
      [song({ source: MediaSource.SoundCloud, url: "https://sc/track" })],
      "only the first 2 tracks were added",
    ],
    player: fakePlayer(),
  });
  const { interaction: i, replies } = interaction();

  await cmd.addToQueue({ ...baseArgs, queueMix: true, interaction: i });

  const reply = replies.at(-1) as string;
  expect(reply).toContain("only the first 2 tracks were added");
  expect(reply).toContain("only available for YouTube");
});
