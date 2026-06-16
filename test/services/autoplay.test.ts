import { beforeEach, expect, mock, test } from "bun:test";
import type LastfmAPI from "../../src/services/lastfm-api.js";
import type YoutubeAPI from "../../src/services/youtube-api.js";

// autoplay imports getYouTubeMixEntries (yt-dlp) and MediaSource (player →
// get-guild-settings → DI). Mock both to control the mix and keep inversify out.
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => ({}),
}));
let mixEntries: Array<Record<string, unknown>> = [];
mock.module("../../src/utils/yt-dlp.js", () => ({
  getYouTubeMixEntries: async () => mixEntries,
  getYouTubeMediaSource: async () => ({ url: "x", headers: {}, isLive: false }),
  getSoundCloudMediaSource: async () => ({
    url: "x",
    headers: {},
    isLive: false,
  }),
}));
mock.module("array-shuffle", () => ({
  default: <T>(items: readonly T[]): T[] => [...items],
}));

const { default: Autoplay } = await import("../../src/services/autoplay.js");
const { MediaSource } = await import("../../src/services/player.js");

const ytSong = (url: string) => ({
  source: MediaSource.Youtube,
  title: "t",
  artist: "a",
  url,
  length: 100,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
});

const seed = (overrides: Record<string, unknown> = {}) =>
  ({
    source: MediaSource.Youtube,
    url: "SEEDVIDEO01",
    title: "Seed Song",
    artist: "Seed Artist",
    length: 200,
    offset: 0,
    playlist: null,
    isLive: false,
    thumbnailUrl: null,
    addedInChannelId: "chan",
    requestedBy: "user",
    ...overrides,
  }) as never;

const makeAutoplay = (youtube: unknown, lastfm?: unknown) =>
  new Autoplay(youtube as YoutubeAPI, lastfm as LastfmAPI);

beforeEach(() => {
  mixEntries = [];
});

test("uses the YouTube mix when Last.fm is not configured", async () => {
  mixEntries = [
    { id: "AAAAAAAAAAA", title: "Mix A", uploader: "Up", duration: 120 },
  ];
  const autoplay = makeAutoplay({ search: async () => [] });
  const result = await autoplay.getRelatedSongs(seed(), {
    limit: 5,
    exclude: new Set(),
  });
  expect(result).toHaveLength(1);
  expect(result[0]?.url).toBe("AAAAAAAAAAA");
});

test("resolves Last.fm similar tracks to YouTube videos", async () => {
  const youtube = { search: async (q: string) => [ytSong(`yt:${q}`)] };
  const lastfm = {
    getSimilar: async () => [
      { name: "S1", artist: "A1" },
      { name: "S2", artist: "A2" },
    ],
  };
  const autoplay = makeAutoplay(youtube, lastfm);
  const result = await autoplay.getRelatedSongs(seed(), {
    limit: 5,
    exclude: new Set(),
  });
  expect(result).toHaveLength(2);
});

test("uses the YouTube mix when Last.fm returns nothing", async () => {
  mixEntries = [
    { id: "BBBBBBBBBBB", title: "Mix B", uploader: "Up", duration: 90 },
  ];
  const autoplay = makeAutoplay(
    { search: async () => [] },
    { getSimilar: async () => [] },
  );
  const result = await autoplay.getRelatedSongs(seed(), {
    limit: 5,
    exclude: new Set(),
  });
  expect(result[0]?.url).toBe("BBBBBBBBBBB");
});

test("returns nothing from the mix for a non-YouTube seed", async () => {
  mixEntries = [{ id: "CCCCCCCCCCC", title: "x", uploader: "u", duration: 1 }];
  const autoplay = makeAutoplay({ search: async () => [] });
  const result = await autoplay.getRelatedSongs(
    seed({ source: MediaSource.HLS, url: "https://stream" }),
    { limit: 5, exclude: new Set() },
  );
  expect(result).toEqual([]);
});

test("excludes already-queued tracks and respects the limit", async () => {
  mixEntries = [
    { id: "AAAAAAAAAAA", title: "A", uploader: "u", duration: 1 },
    { id: "BBBBBBBBBBB", title: "B", uploader: "u", duration: 1 },
    { id: "DDDDDDDDDDD", title: "D", uploader: "u", duration: 1 },
  ];
  const autoplay = makeAutoplay({ search: async () => [] });
  const result = await autoplay.getRelatedSongs(seed(), {
    limit: 1,
    exclude: new Set(["AAAAAAAAAAA"]),
  });
  expect(result).toHaveLength(1);
  expect(result[0]?.url).toBe("BBBBBBBBBBB");
});

test("skips failed YouTube searches and dedupes Last.fm results", async () => {
  let call = 0;
  const youtube = {
    search: async () => {
      call++;
      if (call === 1) {
        throw new Error("search failed");
      }
      return [ytSong("dup")];
    },
  };
  const lastfm = {
    getSimilar: async () => [
      { name: "S1", artist: "A1" },
      { name: "S2", artist: "A2" },
      { name: "S3", artist: "A3" },
    ],
  };
  const result = await makeAutoplay(youtube, lastfm).getRelatedSongs(seed(), {
    limit: 5,
    exclude: new Set(),
  });
  // call 1 rejected, calls 2 & 3 both return "dup" → deduped to one.
  expect(result).toHaveLength(1);
});

test("cleans the seed title and artist before querying Last.fm", async () => {
  let received: { artist: string; title: string } | undefined;
  const lastfm = {
    getSimilar: async (s: { artist: string; title: string }) => {
      received = s;
      return [];
    },
  };
  await makeAutoplay({ search: async () => [] }, lastfm).getRelatedSongs(
    seed({ artist: "Cool Band - Topic", title: "My Song (Official Video)" }),
    { limit: 5, exclude: new Set() },
  );
  expect(received?.artist).toBe("Cool Band");
  expect(received?.title).toBe("My Song");
});

test("combines Last.fm and YouTube mix results, deduped across sources", async () => {
  mixEntries = [
    { id: "MIXAAAAAAAA", title: "M", uploader: "u", duration: 1 },
    { id: "SHARED00001", title: "S", uploader: "u", duration: 1 },
  ];
  const youtube = {
    search: async (q: string) =>
      q.includes("S1") ? [ytSong("LASTFMAAAA1")] : [ytSong("SHARED00001")],
  };
  const lastfm = {
    getSimilar: async () => [
      { name: "S1", artist: "A1" },
      { name: "S2", artist: "A2" },
    ],
  };
  const result = await makeAutoplay(youtube, lastfm).getRelatedSongs(seed(), {
    limit: 5,
    exclude: new Set(),
  });
  // LASTFMAAAA1 (Last.fm only), SHARED00001 (in both -> deduped), MIXAAAAAAAA (mix only).
  expect(result.map((s) => s.url).sort()).toEqual([
    "LASTFMAAAA1",
    "MIXAAAAAAAA",
    "SHARED00001",
  ]);
});
