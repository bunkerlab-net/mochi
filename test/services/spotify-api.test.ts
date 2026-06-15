import { expect, test } from "bun:test";
import SpotifyAPI from "../../src/services/spotify-api.js";
import type ThirdParty from "../../src/services/third-party.js";

// SpotifyAPI just reads `thirdParty.spotify`, so we inject a fake client whose
// methods return the `{ body }` shape spotify-web-api-node produces.
const makeApi = (spotify: Record<string, unknown>) =>
  new SpotifyAPI({ spotify } as unknown as ThirdParty);

const track = (name: string, artist: string) => ({
  name,
  artists: [{ name: artist }],
});

const ALBUM = "https://open.spotify.com/album/6akEvsycLGftJxYudPjmqK";
const PLAYLIST = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";
const TRACK = "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6";
const ARTIST = "https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb";

test("getTrack: maps a track to name and first artist", async () => {
  const api = makeApi({
    getTrack: async () => ({ body: track("Song", "Artist") }),
  });
  expect(await api.getTrack(TRACK)).toEqual({ name: "Song", artist: "Artist" });
});

test("getTrack: falls back to an empty artist when none is present", async () => {
  const api = makeApi({
    getTrack: async () => ({ body: { name: "Song", artists: [] } }),
  });
  expect(await api.getTrack(TRACK)).toEqual({ name: "Song", artist: "" });
});

test("getAlbum: returns mapped tracks and a playlist descriptor", async () => {
  const api = makeApi({
    getAlbum: async () => ({ body: { name: "My Album", href: "album-href" } }),
    getAlbumTracks: async () => ({
      body: { items: [track("T1", "A1"), track("T2", "A2")] },
    }),
  });
  const [tracks, playlist] = await api.getAlbum(ALBUM, 50);
  expect(tracks).toEqual([
    { name: "T1", artist: "A1" },
    { name: "T2", artist: "A2" },
  ]);
  expect(playlist).toEqual({ title: "My Album", source: "album-href" });
});

test("getArtist: returns the artist's top tracks", async () => {
  const api = makeApi({
    getArtistTopTracks: async () => ({
      body: { tracks: [track("Hit", "Star")] },
    }),
  });
  expect(await api.getArtist(ARTIST, 50)).toEqual([
    { name: "Hit", artist: "Star" },
  ]);
});

test("getArtist: limits and shuffles when over the playlist limit", async () => {
  const tracks = Array.from({ length: 10 }, (_, i) => track(`T${i}`, `A${i}`));
  const api = makeApi({
    getArtistTopTracks: async () => ({ body: { tracks } }),
  });
  const result = await api.getArtist(ARTIST, 3);
  expect(result).toHaveLength(3);
});

test("getPlaylist: returns tracks without pagination", async () => {
  const api = makeApi({
    getPlaylist: async () => ({ body: { name: "PL", href: "pl-href" } }),
    getPlaylistTracks: async () => ({
      body: { items: [{ track: track("P1", "A1") }], next: null },
    }),
  });
  const [tracks, playlist] = await api.getPlaylist(PLAYLIST, 50);
  expect(tracks).toEqual([{ name: "P1", artist: "A1" }]);
  expect(playlist).toEqual({ title: "PL", source: "pl-href" });
});

test("getPlaylist: follows the next page until exhausted", async () => {
  let call = 0;
  const api = makeApi({
    getPlaylist: async () => ({ body: { name: "PL", href: "pl-href" } }),
    getPlaylistTracks: async () => {
      call++;
      if (call === 1) {
        return {
          body: {
            items: [{ track: track("P1", "A1") }],
            next: "https://api.spotify.com/v1/x?offset=1&limit=1",
          },
        };
      }
      return { body: { items: [{ track: track("P2", "A2") }], next: null } };
    },
  });
  const [tracks] = await api.getPlaylist(PLAYLIST, 50);
  expect(tracks).toEqual([
    { name: "P1", artist: "A1" },
    { name: "P2", artist: "A2" },
  ]);
});

test("getPlaylist: filters out null track entries", async () => {
  const api = makeApi({
    getPlaylist: async () => ({ body: { name: "PL", href: "pl-href" } }),
    getPlaylistTracks: async () => ({
      body: {
        items: [{ track: track("P1", "A1") }, { track: null }],
        next: null,
      },
    }),
  });
  const [tracks] = await api.getPlaylist(PLAYLIST, 50);
  expect(tracks).toEqual([{ name: "P1", artist: "A1" }]);
});
