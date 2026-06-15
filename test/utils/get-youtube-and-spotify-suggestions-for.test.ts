import { beforeEach, expect, mock, test } from "bun:test";
import type SpotifyWebApi from "spotify-web-api-node";

// getYouTubeAndSpotifySuggestionsFor calls getYouTubeSuggestionsFor (a network
// call) internally; mock it so we exercise only the merge/limit logic. The
// spotify client is a constructor param, so we inject a fake directly.
let ytSuggestions: string[] = [];

mock.module("../../src/utils/get-youtube-suggestions-for.js", () => ({
  default: async () => ytSuggestions,
}));

const { default: getSuggestions, SpotifySuggestionsUnavailableError } =
  await import("../../src/utils/get-youtube-and-spotify-suggestions-for.js");

const spotifyOk = (response: unknown) =>
  ({ search: async () => ({ body: response }) }) as unknown as SpotifyWebApi;

const spotifyFail = () =>
  ({
    search: async () => {
      throw new Error("spotify down");
    },
  }) as unknown as SpotifyWebApi;

beforeEach(() => {
  ytSuggestions = [];
});

test("returns YouTube-only suggestions when spotify is not provided", async () => {
  ytSuggestions = ["a", "b"];
  const result = await getSuggestions("query");
  expect(result).toEqual([
    { name: "YouTube: a", value: "a" },
    { name: "YouTube: b", value: "b" },
  ]);
});

test("limits the number of YouTube suggestions to the limit", async () => {
  ytSuggestions = Array.from({ length: 15 }, (_, i) => `s${i}`);
  const result = await getSuggestions("query", undefined, 5);
  expect(result).toHaveLength(5);
});

test("merges spotify albums and tracks with youtube results", async () => {
  ytSuggestions = ["y1", "y2", "y3", "y4"];
  const response = {
    albums: {
      items: [{ id: "al1", name: "Album1", artists: [{ name: "AA" }] }],
    },
    tracks: { items: [{ id: "tr1", name: "Track1", artists: [] }] },
  };
  const result = await getSuggestions("query", spotifyOk(response), 4);
  expect(result).toContainEqual({
    name: "Spotify: 💿 Album1 - AA",
    value: "spotify:album:al1",
  });
  expect(result).toContainEqual({
    name: "Spotify: 🎵 Track1",
    value: "spotify:track:tr1",
  });
});

test("removes duplicate spotify entries by name", async () => {
  ytSuggestions = [];
  const response = {
    albums: {
      items: [
        { id: "a1", name: "Dup", artists: [] },
        { id: "a2", name: "Dup", artists: [] },
        { id: "a3", name: "Unique", artists: [] },
      ],
    },
    tracks: {
      items: [
        { id: "t1", name: "T1", artists: [] },
        { id: "t2", name: "T2", artists: [] },
      ],
    },
  };
  const result = await getSuggestions("query", spotifyOk(response), 20);
  const albumValues = result
    .map((r) => r.value)
    .filter((v) => typeof v === "string" && v.startsWith("spotify:album:"));
  expect(albumValues).toContain("spotify:album:a1");
  expect(albumValues).not.toContain("spotify:album:a2");
});

test("handles a spotify response with no albums or tracks", async () => {
  ytSuggestions = ["y1"];
  const result = await getSuggestions("query", spotifyOk({}), 10);
  expect(result).toEqual([{ name: "YouTube: y1", value: "y1" }]);
});

test("throws SpotifySuggestionsUnavailableError when spotify search fails", async () => {
  ytSuggestions = ["y1", "y2"];
  try {
    await getSuggestions("query", spotifyFail(), 10);
    throw new Error("expected the call to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(SpotifySuggestionsUnavailableError);
    const typed = error as InstanceType<
      typeof SpotifySuggestionsUnavailableError
    >;
    expect(typed.suggestions).toEqual([
      { name: "YouTube: y1", value: "y1" },
      { name: "YouTube: y2", value: "y2" },
    ]);
  }
});
