import type { APIApplicationCommandOptionChoice } from "discord-api-types/v10";
import type SpotifyWebApi from "spotify-web-api-node";
import debug from "./debug.js";
import getYouTubeSuggestionsFor from "./get-youtube-suggestions-for.js";

export class SpotifySuggestionsUnavailableError extends Error {
  constructor(
    public readonly suggestions: APIApplicationCommandOptionChoice[],
    public readonly originalError: unknown,
  ) {
    super("Spotify autocomplete suggestions failed");
    this.name = "SpotifySuggestionsUnavailableError";
  }
}

const filterDuplicates = <T extends { name: string }>(items: T[]) => {
  const results: T[] = [];

  for (const item of items) {
    if (!results.some((result) => result.name === item.name)) {
      results.push(item);
    }
  }

  return results;
};

const mergeSpotifySuggestions = (
  youtubeSuggestions: APIApplicationCommandOptionChoice[],
  spotifyResponse: SpotifyApi.SearchResponse,
  limit: number,
): APIApplicationCommandOptionChoice[] => {
  const spotifyAlbums = filterDuplicates(spotifyResponse.albums?.items ?? []);
  const spotifyTracks = filterDuplicates(spotifyResponse.tracks?.items ?? []);

  const totalSpotifyResults = spotifyAlbums.length + spotifyTracks.length;

  // Number of results for each source should be roughly the same.
  // If we don't have enough Spotify suggestions, prioritize YouTube results.
  const maxSpotifySuggestions = Math.floor(limit / 2);
  const numOfSpotifySuggestions = Math.min(
    maxSpotifySuggestions,
    totalSpotifyResults,
  );

  const maxSpotifyAlbums = Math.floor(numOfSpotifySuggestions / 2);
  const numOfSpotifyAlbums = Math.min(
    maxSpotifyAlbums,
    spotifyResponse.albums?.items.length ?? 0,
  );
  const maxSpotifyTracks = numOfSpotifySuggestions - numOfSpotifyAlbums;

  // Make room for spotify results
  const maxYouTubeSuggestions = limit - numOfSpotifySuggestions;
  const suggestions = youtubeSuggestions.slice(0, maxYouTubeSuggestions);

  suggestions.push(
    ...spotifyAlbums.slice(0, maxSpotifyAlbums).map((album) => {
      const artist = album.artists[0];
      return {
        name: `Spotify: 💿 ${album.name}${artist ? ` - ${artist.name}` : ""}`,
        value: `spotify:album:${album.id}`,
      };
    }),
  );

  suggestions.push(
    ...spotifyTracks.slice(0, maxSpotifyTracks).map((track) => {
      const artist = track.artists[0];
      return {
        name: `Spotify: 🎵 ${track.name}${artist ? ` - ${artist.name}` : ""}`,
        value: `spotify:track:${track.id}`,
      };
    }),
  );

  return suggestions;
};

const getYouTubeAndSpotifySuggestionsFor = async (
  query: string,
  spotify?: SpotifyWebApi,
  limit = 10,
): Promise<APIApplicationCommandOptionChoice[]> => {
  // Only search Spotify if enabled
  const spotifySuggestionPromise =
    spotify === undefined
      ? undefined
      : spotify
          .search(query, ["album", "track"], { limit })
          .then((response) => ({ response }))
          .catch((error: unknown) => ({ error }));

  const youtubeSuggestions = await getYouTubeSuggestionsFor(query);

  const totalYouTubeResults = youtubeSuggestions.length;
  const numOfYouTubeSuggestions = Math.min(limit, totalYouTubeResults);

  let suggestions: APIApplicationCommandOptionChoice[] = [];

  suggestions.push(
    ...youtubeSuggestions
      .slice(0, numOfYouTubeSuggestions)
      .map((suggestion) => ({
        name: `YouTube: ${suggestion}`,
        value: suggestion,
      })),
  );

  if (spotify !== undefined && spotifySuggestionPromise !== undefined) {
    const spotifyResult = await spotifySuggestionPromise;

    if ("error" in spotifyResult) {
      debug("Spotify autocomplete suggestions failed: %O", spotifyResult.error);
      throw new SpotifySuggestionsUnavailableError(
        suggestions,
        spotifyResult.error,
      );
    }

    suggestions = mergeSpotifySuggestions(
      suggestions,
      spotifyResult.response.body,
      limit,
    );
  }

  return suggestions;
};

export default getYouTubeAndSpotifySuggestionsFor;
