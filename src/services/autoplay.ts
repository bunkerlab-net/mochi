import shuffle from "array-shuffle";
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
   * Both sources are queried in parallel and merged: Last.fm (when configured)
   * for scrobble-based similarity and YouTube's auto-generated radio mix. Either
   * can fill the whole batch alone, so an empty or ineligible source degrades to
   * the other. `exclude` holds URLs already in the queue so we don't repeat
   * recent tracks; the merged pool is deduped across sources, shuffled to vary
   * playback order, then trimmed to `limit`. Returns up to `limit` songs, or an
   * empty list if nothing suitable is found.
   */
  async getRelatedSongs(
    seed: QueuedSong,
    { limit, exclude }: { limit: number; exclude: ReadonlySet<string> },
  ): Promise<SongMetadata[]> {
    // fromLastfm self-guards when Last.fm is unconfigured, so query both blindly.
    const [fromLastfm, fromMix] = await Promise.all([
      this.fromLastfm(seed, limit, exclude),
      this.fromYouTubeMix(seed, limit, exclude),
    ]);

    // Both paths key on the bare 11-char YouTube id in `.url`, so one set dedupes
    // across sources (each list is already internally deduped).
    const seen = new Set<string>();
    const merged: SongMetadata[] = [];
    for (const song of [...fromLastfm, ...fromMix]) {
      if (seen.has(song.url)) {
        continue;
      }

      seen.add(song.url);
      merged.push(song);
    }

    // Shuffle so playback isn't always Last.fm-first, then trim to the batch.
    const songs = shuffle(merged).slice(0, limit);
    if (songs.length > 0) {
      logger.debug(
        "autoplay",
        `seeded ${songs.length} track(s) (${fromLastfm.length} Last.fm + ${fromMix.length} mix)`,
      );
    }

    return songs;
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
