import { expect, test } from "bun:test";
import type Config from "../../src/services/config.js";
import LastfmAPI from "../../src/services/lastfm-api.js";

type Params = Record<string, string>;
type Responses = Record<string, unknown | (() => never)>;

// Build a LastfmAPI with its private `got` replaced by a stub that dispatches
// on the Last.fm `method` search param. A function value throws (to exercise
// the catch branches); any other value is returned from `.json()`.
const makeApi = (responses: Responses) => {
  const api = new LastfmAPI({
    LASTFM_API_KEY: "test-key",
  } as unknown as Config);
  (api as unknown as { got: unknown }).got = (
    _path: string,
    opts: { searchParams: Params },
  ) => ({
    json: async () => {
      const value = responses[opts.searchParams["method"]];
      if (typeof value === "function") {
        return (value as () => unknown)();
      }
      return value;
    },
  });
  return api;
};

const seed = { artist: "Radiohead", title: "Creep" };

test("getSimilar: returns empty when the seed has no artist", async () => {
  const api = makeApi({});
  expect(await api.getSimilar({ artist: "", title: "x" }, 5)).toEqual([]);
});

test("getSimilar: returns track-similar results when present", async () => {
  const api = makeApi({
    "track.getsimilar": {
      similartracks: {
        track: [
          { name: "S1", artist: { name: "A1" } },
          { name: "S2", artist: "A2" },
        ],
      },
    },
  });
  expect(await api.getSimilar(seed, 5)).toEqual([
    { name: "S1", artist: "A1" },
    { name: "S2", artist: "A2" },
  ]);
});

test("getSimilar: collapses Last.fm's single-object track into a list", async () => {
  const api = makeApi({
    "track.getsimilar": {
      similartracks: { track: { name: "Solo", artist: "OneArtist" } },
    },
  });
  expect(await api.getSimilar(seed, 5)).toEqual([
    { name: "Solo", artist: "OneArtist" },
  ]);
});

test("getSimilar: drops entries missing a name or artist", async () => {
  const api = makeApi({
    "track.getsimilar": {
      similartracks: {
        track: [
          { name: "Keep", artist: "A" },
          { name: undefined, artist: "B" },
          { artist: "C" },
          { name: "D" },
        ],
      },
    },
  });
  expect(await api.getSimilar(seed, 5)).toEqual([
    { name: "Keep", artist: "A" },
  ]);
});

test("getSimilar: falls back to similar artists' top tracks", async () => {
  const api = makeApi({
    "track.getsimilar": { similartracks: { track: [] } },
    "artist.getsimilar": { similarartists: { artist: [{ name: "Muse" }] } },
    "artist.gettoptracks": {
      toptracks: { track: [{ name: "Hysteria", artist: "Muse" }] },
    },
  });
  expect(await api.getSimilar(seed, 5)).toEqual([
    { name: "Hysteria", artist: "Muse" },
  ]);
});

test("getSimilar: handles a single similar-artist object", async () => {
  const api = makeApi({
    "track.getsimilar": { similartracks: {} },
    "artist.getsimilar": { similarartists: { artist: { name: "Solo" } } },
    "artist.gettoptracks": {
      toptracks: { track: { name: "Hit", artist: "Solo" } },
    },
  });
  expect(await api.getSimilar(seed, 5)).toEqual([
    { name: "Hit", artist: "Solo" },
  ]);
});

test("getSimilar: falls back to the seed artist when no similar artists", async () => {
  const responses: Responses = {
    "track.getsimilar": { similartracks: { track: [] } },
    "artist.getsimilar": { similarartists: { artist: [] } },
    "artist.gettoptracks": {
      toptracks: { track: [{ name: "Karma Police", artist: "Radiohead" }] },
    },
  };
  const api = makeApi(responses);
  expect(await api.getSimilar(seed, 5)).toEqual([
    { name: "Karma Police", artist: "Radiohead" },
  ]);
});

test("getSimilar: skips the track step when the title is empty", async () => {
  const api = makeApi({
    "track.getsimilar": () => {
      throw new Error("track step should be skipped");
    },
    "artist.getsimilar": { similarartists: { artist: [] } },
    "artist.gettoptracks": {
      toptracks: { track: [{ name: "T", artist: "Radiohead" }] },
    },
  });
  const result = await api.getSimilar({ artist: "Radiohead", title: "" }, 5);
  expect(result).toEqual([{ name: "T", artist: "Radiohead" }]);
});

test("getSimilar: returns empty when the track request throws", async () => {
  const api = makeApi({
    "track.getsimilar": () => {
      throw new Error("network boom");
    },
    "artist.getsimilar": () => {
      throw new Error("also down");
    },
  });
  expect(await api.getSimilar(seed, 5)).toEqual([]);
});

test("getSimilar: returns empty when top-tracks requests all throw", async () => {
  const api = makeApi({
    "track.getsimilar": { similartracks: { track: [] } },
    "artist.getsimilar": { similarartists: { artist: [{ name: "Muse" }] } },
    "artist.gettoptracks": () => {
      throw new Error("toptracks down");
    },
  });
  expect(await api.getSimilar(seed, 5)).toEqual([]);
});
