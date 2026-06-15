import { beforeEach, expect, mock, test } from "bun:test";
import type Config from "../../src/services/config.js";
import type KeyValueCacheProvider from "../../src/services/key-value-cache.js";

// youtube-api imports MediaSource from player.ts → get-guild-settings → the DI
// container. Mock get-guild-settings to keep inversify out of the test graph.
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => ({}),
}));

const { default: YoutubeAPI } = await import(
  "../../src/services/youtube-api.js"
);

// The cache wrapper just runs the wrapped function; the function calls
// `this.got(endpoint).json()`, which we stub to serve canned responses keyed by
// endpoint. This exercises the real request shape and all the parsing logic.
let responses: Record<string, unknown> = {};

const fakeCache = {
  wrap: async (func: (...a: never[]) => unknown) => func(),
} as unknown as KeyValueCacheProvider;

const makeApi = () => {
  const api = new YoutubeAPI(
    { YOUTUBE_API_KEY: "key" } as unknown as Config,
    fakeCache,
  );
  (api as unknown as { got: unknown }).got = (endpoint: string) => ({
    json: async () => responses[endpoint],
  });
  return api;
};

const videoDetail = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  contentDetails: { videoId: id, duration: "PT3M20S" },
  snippet: {
    title: "Title",
    channelTitle: "Channel",
    liveBroadcastContent: "none",
    description: "",
    thumbnails: { medium: { url: "https://thumb/x.jpg" } },
    ...((overrides.snippet as object) ?? {}),
  },
  ...overrides,
});

beforeEach(() => {
  responses = {};
});

test("search: returns metadata for the first matching video", async () => {
  responses = {
    search: { items: [{ id: { videoId: "v1" } }] },
    videos: { items: [videoDetail("v1")] },
  };
  const [song] = await makeApi().search("query", false);
  expect(song?.title).toBe("Title");
  expect(song?.url).toBe("v1");
  expect(song?.length).toBe(200);
});

test("search: returns empty when there are no video ids", async () => {
  responses = { search: { items: [{ id: {} }] } };
  expect(await makeApi().search("query", false)).toEqual([]);
});

test("search: returns empty when no detail is found for the ids", async () => {
  responses = {
    search: { items: [{ id: { videoId: "v1" } }] },
    videos: { items: [] },
  };
  expect(await makeApi().search("query", false)).toEqual([]);
});

test("getVideo: resolves an 11-character video id", async () => {
  responses = { videos: { items: [videoDetail("abcdefghijk")] } };
  const [song] = await makeApi().getVideo("abcdefghijk", false);
  expect(song?.url).toBe("abcdefghijk");
});

test("getVideo: resolves a full youtube url", async () => {
  responses = { videos: { items: [videoDetail("abcdefghijk")] } };
  const [song] = await makeApi().getVideo(
    "https://www.youtube.com/watch?v=abcdefghijk",
    false,
  );
  expect(song?.url).toBe("abcdefghijk");
});

test("getVideo: throws when the url has no resolvable id", async () => {
  expect(makeApi().getVideo("x", false)).rejects.toThrow(
    "Video could not be found",
  );
});

test("getVideo: throws when the video detail is missing", async () => {
  responses = { videos: { items: [] } };
  expect(makeApi().getVideo("abcdefghijk", false)).rejects.toThrow(
    "Video could not be found",
  );
});

test("getVideo: marks a livestream as live", async () => {
  responses = {
    videos: {
      items: [
        videoDetail("abcdefghijk", {
          snippet: {
            title: "Live",
            channelTitle: "C",
            liveBroadcastContent: "live",
            description: "",
            thumbnails: { medium: { url: "u" } },
          },
        }),
      ],
    },
  };
  const [song] = await makeApi().getVideo("abcdefghijk", false);
  expect(song?.isLive).toBe(true);
});

test("getVideo: splits chapters from the description", async () => {
  responses = {
    videos: {
      items: [
        videoDetail("abcdefghijk", {
          snippet: {
            title: "Mix",
            channelTitle: "C",
            liveBroadcastContent: "none",
            description: "0:00 Intro\n1:30 Verse\n3:00 Outro",
            thumbnails: { medium: { url: "u" } },
          },
        }),
      ],
    },
  };
  const songs = await makeApi().getVideo("abcdefghijk", true);
  expect(songs).toHaveLength(3);
  expect(songs[0]?.title).toBe("Intro (Mix)");
  expect(songs[0]?.offset).toBe(0);
});

test("getVideo: returns a single track when there are no chapters", async () => {
  responses = { videos: { items: [videoDetail("abcdefghijk")] } };
  const songs = await makeApi().getVideo("abcdefghijk", true);
  expect(songs).toHaveLength(1);
});

test("getPlaylist: returns metadata for every resolvable item", async () => {
  responses = {
    playlists: {
      items: [
        {
          id: "PL1",
          snippet: { title: "My Playlist" },
          contentDetails: { itemCount: 2 },
        },
      ],
    },
    playlistItems: {
      items: [
        { contentDetails: { videoId: "v1" } },
        { contentDetails: { videoId: "v2" } },
      ],
    },
    videos: { items: [videoDetail("v1"), videoDetail("v2")] },
  };
  const songs = await makeApi().getPlaylist("PL1", false);
  expect(songs).toHaveLength(2);
  expect(songs[0]?.playlist?.title).toBe("My Playlist");
});

test("getPlaylist: throws when the playlist is not found", async () => {
  responses = { playlists: { items: [] } };
  expect(makeApi().getPlaylist("PL1", false)).rejects.toThrow(
    "Playlist could not be found",
  );
});

test("getPlaylist: skips items with no matching video detail", async () => {
  responses = {
    playlists: {
      items: [
        {
          id: "PL1",
          snippet: { title: "PL" },
          contentDetails: { itemCount: 2 },
        },
      ],
    },
    playlistItems: {
      items: [
        { contentDetails: { videoId: "v1" } },
        { contentDetails: { videoId: "gone" } },
      ],
    },
    videos: { items: [videoDetail("v1")] },
  };
  const songs = await makeApi().getPlaylist("PL1", false);
  expect(songs).toHaveLength(1);
});
