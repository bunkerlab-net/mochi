import { inject, injectable, optional } from "inversify";
import { TYPES } from "../types.js";
import logger from "../utils/logger.js";
import { getYouTubeMixEntries } from "../utils/yt-dlp.js";
import type LastfmAPI from "./lastfm-api.js";
import { MediaSource, type QueuedSong, type SongMetadata } from "./player.js";
import type YoutubeAPI from "./youtube-api.js";

@injectable()
export default class Autoplay {
  private readonly youtubeAPI: YoutubeAPI;
  private readonly lastfmAPI: LastfmAPI | undefined;

  constructor(
    @inject(TYPES.Services.YoutubeAPI) youtubeAPI: YoutubeAPI,
    @inject(TYPES.Services.LastfmAPI) @optional() lastfmAPI?: LastfmAPI,
  ) {
    this.youtubeAPI = youtubeAPI;
    this.lastfmAPI = lastfmAPI;
  }

  /**
   * Find songs similar to `seed` to keep playback going when the queue empties.
   *
   * Last.fm is the default source when configured; otherwise — and as a fallback
   * when Last.fm returns nothing — YouTube's auto-generated radio mix is used.
   * `exclude` holds URLs already in the queue so we don't repeat recent tracks.
   * Returns up to `limit` songs, or an empty list if nothing suitable is found.
   */
  async getRelatedSongs(
    seed: QueuedSong,
    { limit, exclude }: { limit: number; exclude: ReadonlySet<string> },
  ): Promise<SongMetadata[]> {
    if (this.lastfmAPI) {
      const fromLastfm = await this.fromLastfm(seed, limit, exclude);
      if (fromLastfm.length > 0) {
        logger.debug(
          "autoplay",
          `seeded ${fromLastfm.length} track(s) via Last.fm`,
        );
        return fromLastfm;
      }
    }

    const fromMix = await this.fromYouTubeMix(seed, limit, exclude);
    if (fromMix.length > 0) {
      logger.debug(
        "autoplay",
        `seeded ${fromMix.length} track(s) via YouTube mix`,
      );
    }

    return fromMix;
  }

  private async fromLastfm(
    seed: QueuedSong,
    limit: number,
    exclude: ReadonlySet<string>,
  ): Promise<SongMetadata[]> {
    if (!this.lastfmAPI) {
      return [];
    }

    const { artist, track } = this.parseSeed(seed);
    const similar = await this.lastfmAPI.getSimilar(
      { artist, title: track },
      limit,
    );
    if (similar.length === 0) {
      return [];
    }

    // Resolve each similar track to a playable YouTube video, the same way the
    // Spotify importer does in get-songs.ts.
    const searches = await Promise.allSettled(
      similar.map(async (item) =>
        this.youtubeAPI.search(`"${item.name}" "${item.artist}"`, false),
      ),
    );

    const songs: SongMetadata[] = [];
    const seen = new Set(exclude);
    for (const search of searches) {
      if (search.status !== "fulfilled") {
        continue;
      }

      const song = search.value.at(0);
      if (song && !seen.has(song.url)) {
        seen.add(song.url);
        songs.push(song);
      }

      if (songs.length >= limit) {
        break;
      }
    }

    return songs;
  }

  private async fromYouTubeMix(
    seed: QueuedSong,
    limit: number,
    exclude: ReadonlySet<string>,
  ): Promise<SongMetadata[]> {
    // The radio mix is keyed off a YouTube video id; HLS/livestream seeds and
    // anything without a real id can't be seeded.
    if (seed.source !== MediaSource.Youtube || seed.url.length !== 11) {
      return [];
    }

    // Over-fetch so post-filtering against the exclude set still yields `limit`.
    const entries = await getYouTubeMixEntries(
      seed.url,
      limit + exclude.size + 5,
    );

    const songs: SongMetadata[] = [];
    for (const entry of entries) {
      if (exclude.has(entry.id)) {
        continue;
      }

      songs.push({
        source: MediaSource.Youtube,
        title: entry.title,
        artist: entry.uploader,
        url: entry.id,
        length: entry.duration,
        offset: 0,
        playlist: null,
        isLive: false,
        thumbnailUrl: null,
      });

      if (songs.length >= limit) {
        break;
      }
    }

    return songs;
  }

  private parseSeed(seed: QueuedSong): { artist: string; track: string } {
    const artist = seed.artist
      .replace(/\s*-\s*topic\s*$/i, "")
      .replace(/\s*vevo\s*$/i, "")
      .trim();

    let track = seed.title
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // (Official Video), [4K], etc.
      .replace(
        /\b(official|music|video|audio|lyrics?|hd|4k|remaster(ed)?|mv)\b/gi,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();

    // "Artist - Song" style titles: keep the part after the separator.
    const parts = track.split(/\s[-–—]\s/);
    if (parts.length >= 2) {
      track = (parts.at(-1) ?? track).trim();
    }

    return { artist, track };
  }
}
