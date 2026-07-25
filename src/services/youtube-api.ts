import getYouTubeID from "get-youtube-id";
import got, { type Got } from "got";
import { inject, injectable } from "inversify";
import { parse, toSeconds } from "iso8601-duration";
import { TYPES } from "../types.js";
import {
  ONE_HOUR_IN_SECONDS,
  ONE_MINUTE_IN_SECONDS,
} from "../utils/constants.js";
import { parseTime } from "../utils/time.js";
import type Config from "./config.js";
import type KeyValueCacheProvider from "./key-value-cache.js";
import {
  MediaSource,
  type QueuedPlaylist,
  type SongMetadata,
} from "./player.js";

interface VideoDetailsResponse {
  id: string;
  contentDetails: {
    videoId: string;
    duration: string;
  };
  snippet: {
    title: string;
    channelTitle: string;
    liveBroadcastContent: string;
    description: string;
    thumbnails: {
      medium: {
        url: string;
      };
    };
  };
}

interface PlaylistResponse {
  id: string;
  contentDetails: {
    itemCount: number;
  };
  snippet: {
    title: string;
  };
}

interface ChannelResponse {
  contentDetails: {
    relatedPlaylists: {
      uploads?: string;
    };
  };
}

interface PlaylistItemsResponse {
  items: PlaylistItem[];
  nextPageToken?: string;
}

interface PlaylistItem {
  id: string;
  contentDetails: {
    videoId: string;
  };
}

interface SearchResponse {
  items: SearchItem[];
}

interface SearchItem {
  id: {
    videoId: string;
  };
}

@injectable()
export default class {
  private readonly youtubeKey: string;
  private readonly cache: KeyValueCacheProvider;
  private readonly got: Got;

  constructor(
    @inject(TYPES.Config) config: Config,
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider,
  ) {
    this.youtubeKey = config.YOUTUBE_API_KEY;
    this.cache = cache;

    this.got = got.extend({
      prefixUrl: "https://www.googleapis.com/youtube/v3/",
      searchParams: {
        key: this.youtubeKey,
        responseType: "json",
      },
    });
  }

  async search(
    query: string,
    shouldSplitChapters: boolean,
  ): Promise<SongMetadata[]> {
    const params = {
      searchParams: {
        part: "snippet",
        q: query,
        type: "video",
        maxResults: "10",
      },
    };

    const { items } = await this.cache.wrap(
      async () => this.got("search", params).json() as Promise<SearchResponse>,
      params,
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    );

    const ids = items.map((item) => item.id.videoId).filter(Boolean);

    if (ids.length === 0) {
      return [];
    }

    const videos = await this.getVideosByID(ids);
    const firstVideo = ids
      .map((id) => videos.find((video) => video.id === id))
      .find(Boolean);

    return firstVideo
      ? this.getMetadataFromVideo({ video: firstVideo, shouldSplitChapters })
      : [];
  }

  async getVideo(
    url: string,
    shouldSplitChapters: boolean,
  ): Promise<SongMetadata[]> {
    const videoId = url.length === 11 ? url : getYouTubeID(url);

    if (!videoId) {
      throw new Error("Video could not be found.");
    }

    const result = await this.getVideosByID([videoId]);
    const video = result.at(0);

    if (!video) {
      throw new Error("Video could not be found.");
    }

    return this.getMetadataFromVideo({ video, shouldSplitChapters });
  }

  /**
   * Resolve a channel (a YouTube Music artist page is one) to its uploads
   * playlist, which holds every track the channel published. Capped at `limit`
   * because channels routinely hold thousands of uploads.
   */
  async getChannel(
    channelId: string,
    shouldSplitChapters: boolean,
    limit: number,
  ): Promise<SongMetadata[]> {
    const channelParams = {
      searchParams: {
        part: "contentDetails",
        id: channelId,
      },
    };

    const { items: channels } = await this.cache.wrap(
      async () =>
        this.got("channels", channelParams).json() as Promise<{
          items: ChannelResponse[];
        }>,
      channelParams,
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    );

    const uploadsListId =
      channels.at(0)?.contentDetails.relatedPlaylists.uploads;

    if (!uploadsListId) {
      throw new Error("Channel could not be found.");
    }

    return this.getPlaylist(uploadsListId, shouldSplitChapters, limit);
  }

  async getPlaylist(
    listId: string,
    shouldSplitChapters: boolean,
    limit?: number,
  ): Promise<SongMetadata[]> {
    const playlistParams = {
      searchParams: {
        part: "id, snippet, contentDetails",
        id: listId,
      },
    };
    const { items: playlists } = await this.cache.wrap(
      async () =>
        this.got("playlists", playlistParams).json() as Promise<{
          items: PlaylistResponse[];
        }>,
      playlistParams,
      {
        expiresIn: ONE_MINUTE_IN_SECONDS,
      },
    );

    const playlist = playlists.at(0);

    if (!playlist) {
      throw new Error("Playlist could not be found.");
    }

    const { playlistVideos, videoDetails } =
      await this.fetchPlaylistItemsAndDetails(listId, playlist, limit);

    const queuedPlaylist = {
      title: playlist.snippet.title,
      source: playlist.id,
    };

    const songsToReturn: SongMetadata[] = [];

    for (const video of playlistVideos) {
      try {
        const videoDetail = videoDetails.find(
          (i: { id: string }) => i.id === video.contentDetails.videoId,
        );
        if (!videoDetail) {
          continue;
        }

        songsToReturn.push(
          ...this.getMetadataFromVideo({
            video: videoDetail,
            queuedPlaylist,
            shouldSplitChapters,
          }),
        );
      } catch (_: unknown) {
        // Private and deleted videos are sometimes in playlists, duration of these
        // is not returned and they should not be added to the queue.
      }
    }

    return songsToReturn;
  }

  private async fetchPlaylistItemsAndDetails(
    listId: string,
    playlist: PlaylistResponse,
    limit?: number,
  ): Promise<{
    playlistVideos: PlaylistItem[];
    videoDetails: VideoDetailsResponse[];
  }> {
    const playlistVideos: PlaylistItem[] = [];
    const videoDetailsPromises: Array<Promise<void>> = [];
    const videoDetails: VideoDetailsResponse[] = [];

    let nextToken: string | undefined;
    const targetCount = Math.min(
      playlist.contentDetails.itemCount,
      limit ?? Number.POSITIVE_INFINITY,
    );

    while (playlistVideos.length < targetCount) {
      const { items, nextPageToken } = await this.fetchPlaylistItemsPage(
        listId,
        Math.min(50, targetCount - playlistVideos.length),
        nextToken,
      );

      nextToken = nextPageToken;

      // itemCount counts private and deleted videos that playlistItems never
      // returns, so targetCount can be unreachable. Stop as soon as a page
      // makes no progress; otherwise a missing token would have us request the
      // first page forever.
      if (items.length === 0) {
        break;
      }

      playlistVideos.push(...items);

      // Start fetching extra details about videos
      // PlaylistItem misses some details, eg. if the video is a livestream
      videoDetailsPromises.push(
        (async () => {
          const videoDetailItems = await this.getVideosByID(
            items.map((item) => item.contentDetails.videoId),
          );
          videoDetails.push(...videoDetailItems);
        })(),
      );

      if (!nextPageToken) {
        break;
      }
    }

    await Promise.all(videoDetailsPromises);

    return { playlistVideos, videoDetails };
  }

  private async fetchPlaylistItemsPage(
    listId: string,
    maxResults: number,
    pageToken: string | undefined,
  ): Promise<PlaylistItemsResponse> {
    const playlistItemsParams = {
      searchParams: {
        part: "id, contentDetails",
        playlistId: listId,
        maxResults: maxResults.toString(),
        pageToken,
      },
    };

    return this.cache.wrap(
      async () =>
        this.got(
          "playlistItems",
          playlistItemsParams,
        ).json() as Promise<PlaylistItemsResponse>,
      playlistItemsParams,
      {
        expiresIn: ONE_MINUTE_IN_SECONDS,
      },
    );
  }

  private getMetadataFromVideo({
    video,
    queuedPlaylist,
    shouldSplitChapters,
  }: {
    video: VideoDetailsResponse; // | YoutubePlaylistItem;
    queuedPlaylist?: QueuedPlaylist;
    shouldSplitChapters?: boolean;
  }): SongMetadata[] {
    const base: SongMetadata = {
      source: MediaSource.Youtube,
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      length: toSeconds(parse(video.contentDetails.duration)),
      offset: 0,
      url: video.id,
      playlist: queuedPlaylist ?? null,
      isLive: video.snippet.liveBroadcastContent === "live",
      thumbnailUrl: video.snippet.thumbnails.medium.url,
    };

    if (!shouldSplitChapters) {
      return [base];
    }

    const chapters = this.parseChaptersFromDescription(
      video.snippet.description,
      base.length,
    );

    if (!chapters) {
      return [base];
    }

    const tracks: SongMetadata[] = [];

    for (const [label, { offset, length }] of chapters) {
      tracks.push({
        ...base,
        offset,
        length,
        title: `${label} (${base.title})`,
      });
    }

    return tracks;
  }

  private parseChaptersFromDescription(
    description: string,
    videoDurationSeconds: number,
  ) {
    const map = new Map<string, { offset: number; length: number }>();
    let foundFirstTimestamp = false;

    const foundTimestamps: Array<{ name: string; offset: number }> = [];
    for (const line of description.split("\n")) {
      const timestamps = Array.from(line.matchAll(/(?:\d+:)+\d+/g));
      const timestamp =
        timestamps.length === 1 ? timestamps[0]?.[0] : undefined;
      if (!timestamp) {
        continue;
      }

      if (!foundFirstTimestamp) {
        if (/0{1,2}:00/.test(timestamp)) {
          foundFirstTimestamp = true;
        } else {
          continue;
        }
      }

      const seconds = parseTime(timestamp);
      const chapterName = line.split(timestamp)[1]?.trim() ?? "";

      foundTimestamps.push({ name: chapterName, offset: seconds });
    }

    for (const [i, { name, offset }] of foundTimestamps.entries()) {
      const nextOffset = foundTimestamps[i + 1]?.offset;
      map.set(name, {
        offset,
        length:
          i === foundTimestamps.length - 1 || nextOffset === undefined
            ? videoDurationSeconds - offset
            : nextOffset - offset,
      });
    }

    if (!map.size) {
      return null;
    }

    return map;
  }

  private async getVideosByID(
    videoIDs: string[],
  ): Promise<VideoDetailsResponse[]> {
    const p = {
      searchParams: {
        part: "id, snippet, contentDetails",
        id: videoIDs.join(","),
      },
    };

    const { items: videos } = await this.cache.wrap(
      async () =>
        this.got("videos", p).json() as Promise<{
          items: VideoDetailsResponse[];
        }>,
      p,
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    );
    return videos;
  }
}
