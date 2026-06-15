import { beforeEach, expect, mock, test } from "bun:test";
import type SpotifyAPI from "../../src/services/spotify-api.js";
import type YoutubeAPI from "../../src/services/youtube-api.js";

// get-songs imports MediaSource (player → DI) and ffmpeg. Mock get-guild-settings
// to keep inversify out, and ffmpeg to control httpLiveStream's ffprobe.
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => ({}),
}));
let ffprobeError: Error | null = null;
mock.module("fluent-ffmpeg", () => ({
  default: () => ({
    ffprobe: (cb: (err: Error | null, data: unknown) => void) => {
      cb(ffprobeError, {});
    },
  }),
}));

// SoundCloud resolution shells out to yt-dlp via getSoundCloudSongs. Stub it so
// dispatch is tested without spawning a process.
type SoundCloudResult = {
  tracks: Array<{
    url: string;
    title: string;
    uploader: string;
    duration: number;
    thumbnail: string | null;
  }>;
  playlist: { title: string; url: string } | null;
};
let soundcloudResult: SoundCloudResult = { tracks: [], playlist: null };
mock.module("../../src/utils/yt-dlp.js", () => ({
  getSoundCloudSongs: async () => soundcloudResult,
}));

const { default: GetSongs } = await import("../../src/services/get-songs.js");
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

const makeGetSongs = (youtube: unknown, spotify?: unknown) =>
  new GetSongs(youtube as YoutubeAPI, spotify as SpotifyAPI);

beforeEach(() => {
  ffprobeError = null;
  soundcloudResult = { tracks: [], playlist: null };
});

test("resolves a YouTube video url", async () => {
  const youtube = { getVideo: async () => [ytSong("vid")] };
  const [songs] = await makeGetSongs(youtube).getSongs(
    "https://www.youtube.com/watch?v=abcdefghijk",
    50,
    false,
  );
  expect(songs[0]?.url).toBe("vid");
});

test("resolves a YouTube playlist url", async () => {
  const youtube = {
    getPlaylist: async () => [ytSong("p1"), ytSong("p2")],
  };
  const [songs] = await makeGetSongs(youtube).getSongs(
    "https://www.youtube.com/watch?v=abcdefghijk&list=PL123",
    50,
    false,
  );
  expect(songs).toHaveLength(2);
});

test("searches YouTube for a non-url query", async () => {
  const youtube = { search: async () => [ytSong("found")] };
  const [songs, msg] = await makeGetSongs(youtube).getSongs(
    "never gonna give you up",
    50,
    false,
  );
  expect(songs[0]?.url).toBe("found");
  expect(msg).toBe("");
});

test("throws when a Spotify url is given but Spotify is disabled", async () => {
  const getSongs = makeGetSongs({ search: async () => [] });
  expect(
    getSongs.getSongs("https://open.spotify.com/track/abc", 50, false),
  ).rejects.toThrow("Spotify is not enabled");
});

test("converts a Spotify track to a YouTube result", async () => {
  const youtube = { search: async () => [ytSong("yt-for-track")] };
  const spotify = { getTrack: async () => ({ name: "S", artist: "A" }) };
  const [songs] = await makeGetSongs(youtube, spotify).getSongs(
    "https://open.spotify.com/track/abc",
    50,
    false,
  );
  expect(songs[0]?.url).toBe("yt-for-track");
});

test("converts a Spotify album and notes truncation and misses", async () => {
  let call = 0;
  const youtube = {
    search: async () => {
      call++;
      if (call === 1) {
        throw new Error("not found");
      }
      return [ytSong(`yt-${call}`)];
    },
  };
  const spotify = {
    getAlbum: async () => [
      [
        { name: "T1", artist: "A1" },
        { name: "T2", artist: "A2" },
      ],
      { title: "Album", source: "src" },
    ],
  };
  const [songs, msg] = await makeGetSongs(youtube, spotify).getSongs(
    "https://open.spotify.com/album/abc",
    1,
    false,
  );
  expect(songs.length).toBeGreaterThanOrEqual(1);
  expect(msg).toContain("random sample of 1");
  expect(msg).toContain("1 song was not found");
});

test("converts a Spotify playlist", async () => {
  const youtube = { search: async () => [ytSong("yt-pl")] };
  const spotify = {
    getPlaylist: async () => [
      [{ name: "T", artist: "A" }],
      { title: "PL", source: "src" },
    ],
  };
  const [songs] = await makeGetSongs(youtube, spotify).getSongs(
    "https://open.spotify.com/playlist/abc",
    50,
    false,
  );
  expect(songs[0]?.playlist?.title).toBe("PL");
});

test("converts a Spotify artist", async () => {
  const youtube = { search: async () => [ytSong("yt-art")] };
  const spotify = {
    getArtist: async () => [{ name: "T", artist: "A" }],
  };
  const [songs] = await makeGetSongs(youtube, spotify).getSongs(
    "https://open.spotify.com/artist/abc",
    50,
    false,
  );
  expect(songs[0]?.url).toBe("yt-art");
});

test("treats an unknown http url as a live stream", async () => {
  ffprobeError = null;
  const [songs] = await makeGetSongs({ search: async () => [] }).getSongs(
    "https://example.com/stream.m3u8",
    50,
    false,
  );
  expect(songs[0]?.source).toBe(MediaSource.HLS);
  expect(songs[0]?.isLive).toBe(true);
});

test("falls back to YouTube search when a stream cannot be probed", async () => {
  ffprobeError = new Error("not a stream");
  const youtube = { search: async () => [ytSong("fallback")] };
  const [songs] = await makeGetSongs(youtube).getSongs(
    "https://example.com/not-media",
    50,
    false,
  );
  expect(songs[0]?.url).toBe("fallback");
});

test("resolves a SoundCloud track", async () => {
  soundcloudResult = {
    tracks: [
      {
        url: "https://soundcloud.com/u/track",
        title: "T",
        uploader: "U",
        duration: 120,
        thumbnail: null,
      },
    ],
    playlist: null,
  };
  const [songs] = await makeGetSongs({ search: async () => [] }).getSongs(
    "https://soundcloud.com/u/track",
    50,
    false,
  );
  expect(songs[0]?.source).toBe(MediaSource.SoundCloud);
  expect(songs[0]?.url).toBe("https://soundcloud.com/u/track");
  expect(songs[0]?.artist).toBe("U");
  expect(songs[0]?.playlist).toBeNull();
});

test("resolves a SoundCloud set and attaches its playlist", async () => {
  soundcloudResult = {
    tracks: [
      {
        url: "https://soundcloud.com/u/a",
        title: "A",
        uploader: "U",
        duration: 100,
        thumbnail: "ta",
      },
      {
        url: "https://soundcloud.com/u/b",
        title: "B",
        uploader: "U",
        duration: 200,
        thumbnail: null,
      },
    ],
    playlist: { title: "My Set", url: "https://soundcloud.com/u/sets/my-set" },
  };
  const [songs] = await makeGetSongs({ search: async () => [] }).getSongs(
    "https://soundcloud.com/u/sets/my-set",
    50,
    false,
  );
  expect(songs).toHaveLength(2);
  expect(songs[0]?.playlist).toEqual({
    title: "My Set",
    source: "https://soundcloud.com/u/sets/my-set",
  });
});

test("returns no songs for an unresolvable SoundCloud url", async () => {
  soundcloudResult = { tracks: [], playlist: null };
  const [songs] = await makeGetSongs({ search: async () => [] }).getSongs(
    "https://soundcloud.com/u/private",
    50,
    false,
  );
  expect(songs).toHaveLength(0);
});
