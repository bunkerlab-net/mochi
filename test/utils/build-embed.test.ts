import { expect, mock, test } from "bun:test";

// build-embed imports player.ts, which imports get-guild-settings → the DI
// container. Mock get-guild-settings to keep inversify out of the test graph;
// build-embed itself runs for real against fake players.
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => ({}),
}));

const { buildPlayingMessageEmbed, buildQueueEmbed } = await import(
  "../../src/utils/build-embed.js"
);
const { STATUS, MediaSource } = await import("../../src/services/player.js");

const song = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const player = (overrides: Record<string, unknown> = {}) =>
  ({
    getCurrent: () => song(),
    getQueue: () => [],
    queueSize: () => 0,
    getPosition: () => 0,
    getVolume: () => 100,
    status: STATUS.PLAYING,
    loopCurrentSong: false,
    loopCurrentQueue: false,
    ...overrides,
  }) as never;

test("buildPlayingMessageEmbed: titles 'Now Playing' while playing", () => {
  const embed = buildPlayingMessageEmbed(player());
  expect(embed.data.title).toBe("Now Playing");
  expect(embed.data.description).toContain("youtube.com/watch?v=abcdefghijk");
});

test("buildPlayingMessageEmbed: titles 'Paused' when paused", () => {
  const embed = buildPlayingMessageEmbed(player({ status: STATUS.PAUSED }));
  expect(embed.data.title).toBe("Paused");
});

test("buildPlayingMessageEmbed: throws when nothing is playing", () => {
  expect(() =>
    buildPlayingMessageEmbed(player({ getCurrent: () => null })),
  ).toThrow("No playing song found");
});

test("buildPlayingMessageEmbed: sets a thumbnail when present", () => {
  const embed = buildPlayingMessageEmbed(
    player({ getCurrent: () => song({ thumbnailUrl: "https://thumb/x.jpg" }) }),
  );
  expect(embed.data.thumbnail?.url).toBe("https://thumb/x.jpg");
});

test("buildPlayingMessageEmbed: renders an offset as a &t= parameter", () => {
  const embed = buildPlayingMessageEmbed(
    player({ getCurrent: () => song({ offset: 42 }) }),
  );
  expect(embed.data.description).toContain("&t=42");
});

test("buildPlayingMessageEmbed: links HLS sources directly", () => {
  const embed = buildPlayingMessageEmbed(
    player({
      getCurrent: () =>
        song({ source: MediaSource.HLS, url: "https://stream/live.m3u8" }),
    }),
  );
  expect(embed.data.description).toContain("https://stream/live.m3u8");
});

test("buildPlayingMessageEmbed: shows 'live' for a livestream", () => {
  const embed = buildPlayingMessageEmbed(
    player({ getCurrent: () => song({ isLive: true }) }),
  );
  expect(embed.data.description).toContain("live");
});

test("buildPlayingMessageEmbed: shows the loop indicator for a looped song", () => {
  const embed = buildPlayingMessageEmbed(player({ loopCurrentSong: true }));
  expect(embed.data.description).toContain("🔂");
});

test("buildQueueEmbed: throws when the queue is empty", () => {
  expect(() =>
    buildQueueEmbed(player({ getCurrent: () => null }), 1, 10),
  ).toThrow("queue is empty");
});

test("buildQueueEmbed: throws when the page is out of range", () => {
  expect(() => buildQueueEmbed(player(), 5, 10)).toThrow("isn't that big");
});

test("buildQueueEmbed: summarizes an empty up-next queue", () => {
  const embed = buildQueueEmbed(player(), 1, 10);
  const inQueue = embed.data.fields?.find((f) => f.name === "In queue");
  expect(inQueue?.value).toBe("-");
});

test("buildQueueEmbed: lists upcoming songs and counts them", () => {
  const upcoming = [
    song({ title: "Next1", length: 60 }),
    song({ title: "Next2", length: 120 }),
  ];
  const embed = buildQueueEmbed(
    player({ getQueue: () => upcoming, queueSize: () => 2 }),
    1,
    10,
  );
  const inQueue = embed.data.fields?.find((f) => f.name === "In queue");
  expect(inQueue?.value).toBe("2 songs");
  expect(embed.data.description).toContain("Next1");
});

test("buildQueueEmbed: pluralizes a single queued song and notes loop", () => {
  const embed = buildQueueEmbed(
    player({
      getQueue: () => [song({ title: "Solo" })],
      queueSize: () => 1,
      loopCurrentSong: true,
    }),
    1,
    10,
  );
  const inQueue = embed.data.fields?.find((f) => f.name === "In queue");
  expect(inQueue?.value).toBe("1 song");
  expect(embed.data.title).toContain("loop on");
});

test("buildQueueEmbed: includes the playlist title in the footer", () => {
  const embed = buildQueueEmbed(
    player({
      getCurrent: () => song({ playlist: { title: "My Mix", source: "src" } }),
    }),
    1,
    10,
  );
  expect(embed.data.footer?.text).toContain("My Mix");
});
