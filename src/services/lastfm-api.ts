import got, { type Got } from "got";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import type Config from "./config.js";

export interface LastfmSimilar {
  name: string;
  artist: string;
}

interface LastfmTrack {
  name?: string;
  artist?: { name?: string } | string;
}

interface SimilarTracksResponse {
  similartracks?: {
    track?: LastfmTrack[] | LastfmTrack;
  };
}

interface SimilarArtistsResponse {
  similarartists?: {
    artist?: Array<{ name?: string }> | { name?: string };
  };
}

interface TopTracksResponse {
  toptracks?: {
    track?: LastfmTrack[] | LastfmTrack;
  };
}

@injectable()
export default class LastfmAPI {
  private readonly got: Got;

  constructor(@inject(TYPES.Config) config: Config) {
    this.got = got.extend({
      prefixUrl: "https://ws.audioscrobbler.com/2.0/",
      searchParams: {
        api_key: config.LASTFM_API_KEY,
        format: "json",
      },
    });
  }

  /**
   * Find tracks similar to a seed. Prefers `track.getSimilar`; when that yields
   * nothing (common with messy YouTube titles), falls back to the top tracks of
   * the closest similar artists, then the seed artist itself.
   */
  async getSimilar(
    seed: { artist: string; title: string },
    limit: number,
  ): Promise<LastfmSimilar[]> {
    if (!seed.artist) {
      return [];
    }

    const fromTrack = await this.getSimilarTracks(
      seed.artist,
      seed.title,
      limit,
    );
    if (fromTrack.length > 0) {
      return fromTrack;
    }

    return this.getSimilarArtistTracks(seed.artist, limit);
  }

  private async getSimilarTracks(
    artist: string,
    track: string,
    limit: number,
  ): Promise<LastfmSimilar[]> {
    if (!track) {
      return [];
    }

    try {
      const response = (await this.got("", {
        searchParams: {
          method: "track.getsimilar",
          artist,
          track,
          autocorrect: "1",
          limit: limit.toString(),
        },
      }).json()) as SimilarTracksResponse;

      return this.toSimilarList(response.similartracks?.track);
    } catch {
      return [];
    }
  }

  private async getSimilarArtistTracks(
    artist: string,
    limit: number,
  ): Promise<LastfmSimilar[]> {
    try {
      const response = (await this.got("", {
        searchParams: {
          method: "artist.getsimilar",
          artist,
          autocorrect: "1",
          limit: "5",
        },
      }).json()) as SimilarArtistsResponse;

      const raw = response.similarartists?.artist;
      const similarArtists = (Array.isArray(raw) ? raw : raw ? [raw] : [])
        .map((candidate) => candidate.name)
        .filter((name): name is string => Boolean(name));

      for (const candidate of [...similarArtists, artist]) {
        const tracks = await this.getTopTracks(candidate, limit);
        if (tracks.length > 0) {
          return tracks;
        }
      }
    } catch {
      // Fall through to an empty result.
    }

    return [];
  }

  private async getTopTracks(
    artist: string,
    limit: number,
  ): Promise<LastfmSimilar[]> {
    try {
      const response = (await this.got("", {
        searchParams: {
          method: "artist.gettoptracks",
          artist,
          autocorrect: "1",
          limit: limit.toString(),
        },
      }).json()) as TopTracksResponse;

      return this.toSimilarList(response.toptracks?.track);
    } catch {
      return [];
    }
  }

  private toSimilarList(
    raw: LastfmTrack[] | LastfmTrack | undefined,
  ): LastfmSimilar[] {
    // Last.fm collapses a single-element list into a bare object.
    const tracks = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return tracks.reduce<LastfmSimilar[]>((accum, track) => {
      const name = track.name;
      const artist =
        typeof track.artist === "string" ? track.artist : track.artist?.name;
      if (name && artist) {
        accum.push({ name, artist });
      }

      return accum;
    }, []);
  }
}
