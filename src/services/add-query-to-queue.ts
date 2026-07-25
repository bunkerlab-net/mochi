import shuffle from "array-shuffle";
import {
  type ChatInputCommandInteraction,
  type GuildMember,
  MessageFlags,
} from "discord.js";
import { inject, injectable } from "inversify";
import { SponsorBlock } from "sponsorblock-api";
import type PlayerManager from "../managers/player.js";
import type GetSongs from "../services/get-songs.js";
import { TYPES } from "../types.js";
import { buildPlayingMessageEmbed } from "../utils/build-embed.js";
import {
  getMemberVoiceChannel,
  getMostPopularVoiceChannel,
} from "../utils/channels.js";
import { ONE_HOUR_IN_SECONDS } from "../utils/constants.js";
import { NoNextTrackError } from "../utils/errors.js";
import { getGuildSettings } from "../utils/get-guild-settings.js";
import { getGuild, getGuildId, getMemberUserId } from "../utils/interaction.js";
import logger from "../utils/logger.js";
import type Autoplay from "./autoplay.js";
import type Config from "./config.js";
import type KeyValueCacheProvider from "./key-value-cache.js";
import type Player from "./player.js";
import {
  MediaSource,
  type QueuedSong,
  type SongMetadata,
  STATUS,
} from "./player.js";

@injectable()
export default class AddQueryToQueue {
  private readonly sponsorBlock: SponsorBlock | undefined;
  private sponsorBlockDisabledUntil?: Date;
  private readonly sponsorBlockTimeoutDelay;
  private readonly cache: KeyValueCacheProvider;

  constructor(
    @inject(TYPES.Services.GetSongs) private readonly getSongs: GetSongs,
    @inject(TYPES.Managers.Player)
    private readonly playerManager: PlayerManager,
    @inject(TYPES.Config) private readonly config: Config,
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider,
    @inject(TYPES.Services.Autoplay) private readonly autoplay: Autoplay,
  ) {
    this.sponsorBlockTimeoutDelay = config.SPONSORBLOCK_TIMEOUT;
    this.sponsorBlock = config.ENABLE_SPONSORBLOCK
      ? new SponsorBlock("mochi-sb-integration") // UserID matters only for submissions
      : undefined;
    this.cache = cache;
  }

  public async addToQueue({
    query,
    addToFrontOfQueue,
    shuffleAdditions,
    shouldSplitChapters,
    queueMix,
    sessionAutoplay,
    skipCurrentTrack,
    interaction,
  }: {
    query: string;
    addToFrontOfQueue: boolean;
    shuffleAdditions: boolean;
    shouldSplitChapters: boolean;
    queueMix: boolean;
    sessionAutoplay: boolean | null;
    skipCurrentTrack: boolean;
    interaction: ChatInputCommandInteraction;
  }): Promise<void> {
    const guildId = getGuildId(interaction);
    const player = this.playerManager.get(guildId);

    const [targetVoiceChannel] =
      getMemberVoiceChannel(interaction.member as GuildMember) ??
      getMostPopularVoiceChannel(getGuild(interaction));

    const {
      newSongs,
      firstSong,
      currentBeforeEnqueue,
      extraMsg: initialExtraMsg,
    } = await this.prepareAndEnqueueSongs({
      query,
      addToFrontOfQueue,
      shuffleAdditions,
      shouldSplitChapters,
      queueMix,
      player,
      interaction,
    });

    // Session-scoped autoplay override, applied once the query actually
    // queued something. player.forget() drops it when the session ends.
    if (sessionAutoplay !== null) {
      player.sessionAutoplay = sessionAutoplay;
    }

    const extraMsg = await this.connectAndPlay(
      player,
      targetVoiceChannel,
      interaction,
      currentBeforeEnqueue !== null,
      initialExtraMsg,
    );

    const didSkipCurrentTrack = await this.maybeSkipCurrentTrack({
      player,
      skipCurrentTrack,
      currentBeforeEnqueue,
    });

    await this.buildQueueReply(
      interaction,
      newSongs,
      firstSong,
      addToFrontOfQueue,
      didSkipCurrentTrack,
      extraMsg,
    );
  }

  // Skips the freshly-enqueued front track into playback when a track was
  // already playing; returns whether it skipped.
  private async maybeSkipCurrentTrack({
    player,
    skipCurrentTrack,
    currentBeforeEnqueue,
  }: {
    player: Player;
    skipCurrentTrack: boolean;
    currentBeforeEnqueue: QueuedSong | null;
  }): Promise<boolean> {
    // Skip only when the track that was playing when we enqueued is still the
    // current one. On an idle/empty queue the new song becomes current and
    // connectAndPlay starts it (nothing to skip); if the previous track ended
    // while we resolved songs, identity differs so we don't skip past the
    // request. forward() resumes playback, so it plays even if we were paused.
    const shouldSkip =
      skipCurrentTrack &&
      currentBeforeEnqueue !== null &&
      player.getCurrent() === currentBeforeEnqueue;
    if (!shouldSkip) {
      return false;
    }

    try {
      await player.forward(1);
    } catch (error: unknown) {
      // forward() throws NoNextTrackError when there is genuinely no next track
      // (e.g. the queued target was cleared during the awaited connectAndPlay).
      // Log it and convert only that case to the friendly reply; any other
      // failure is a real playback error (e.g. an unavailable track), so
      // rethrow it unchanged (logged upstream) so its reason reaches the user.
      if (error instanceof NoNextTrackError) {
        logger.warn("queue", "nothing to skip to", error);
        throw new Error("no song to skip to");
      }

      throw error;
    }

    return true;
  }

  private async prepareAndEnqueueSongs({
    query,
    addToFrontOfQueue,
    shuffleAdditions,
    shouldSplitChapters,
    queueMix,
    player,
    interaction,
  }: {
    query: string;
    addToFrontOfQueue: boolean;
    shuffleAdditions: boolean;
    shouldSplitChapters: boolean;
    queueMix: boolean;
    player: Player;
    interaction: ChatInputCommandInteraction;
  }): Promise<{
    newSongs: SongMetadata[];
    firstSong: SongMetadata;
    currentBeforeEnqueue: QueuedSong | null;
    extraMsg: string;
  }> {
    const guildId = getGuildId(interaction);
    const settings = await getGuildSettings(guildId);
    const { playlistLimit, queueAddResponseEphemeral } = settings;

    await interaction.deferReply(
      queueAddResponseEphemeral ? { flags: MessageFlags.Ephemeral } : {},
    );

    let [newSongs, extraMsg] = await this.resolveSongs({
      query,
      playlistLimit,
      shouldSplitChapters,
      queueMix,
      player,
    });

    if (shuffleAdditions) {
      newSongs = shuffle(newSongs);
    }

    if (this.config.ENABLE_SPONSORBLOCK) {
      newSongs = await Promise.all(
        newSongs.map(this.skipNonMusicSegments.bind(this)),
      );
    }

    // Capture the current track right before enqueueing so the skip decision
    // uses identity: if the previous track ends (or the queue advances) while
    // we resolve songs, getCurrent() differs and we won't skip the request.
    const currentBeforeEnqueue = player.getCurrent();

    this.addSongsToQueue({ newSongs, addToFrontOfQueue, player, interaction });

    logger.info(
      "queue",
      `queued ${newSongs.length} song(s) from "${query}"${addToFrontOfQueue ? " (front of queue)" : ""}`,
    );

    const firstSong = newSongs[0];
    if (!firstSong) {
      throw new Error("no songs found");
    }

    return { newSongs, firstSong, currentBeforeEnqueue, extraMsg };
  }

  // Resolve a query into the tracks to enqueue, turning it into a YouTube mix
  // first when the request asked for one.
  private async resolveSongs({
    query,
    playlistLimit,
    shouldSplitChapters,
    queueMix,
    player,
  }: {
    query: string;
    playlistLimit: number;
    shouldSplitChapters: boolean;
    queueMix: boolean;
    player: Player;
  }): Promise<[SongMetadata[], string]> {
    const [songs, resolutionMsg] = await this.getSongs.getSongs(
      query,
      playlistLimit,
      shouldSplitChapters,
    );

    if (songs.length === 0) {
      throw new Error("no songs found");
    }

    if (!queueMix) {
      return [songs, resolutionMsg];
    }

    const mix = await this.expandToMix({
      songs,
      limit: playlistLimit,
      player,
      resolutionMsg,
    });

    return [mix.songs, mix.message];
  }

  // Turn a resolved query into its first track plus that track's YouTube radio
  // mix, the way YouTube's "start radio" works. A mix radiates from one video,
  // so the rest of a multi-track query is dropped rather than interleaved with
  // unrelated radio picks, and `resolutionMsg` (a channel's truncation notice,
  // say) is dropped with it once it stops describing the queue. Every dead end
  // carries a message, so `mix:true` is never quietly unhonored.
  private async expandToMix({
    songs,
    limit,
    player,
    resolutionMsg,
  }: {
    songs: SongMetadata[];
    limit: number;
    player: Player;
    resolutionMsg: string;
  }): Promise<{ songs: SongMetadata[]; message: string }> {
    const seed = songs[0];

    if (
      !seed ||
      seed.source !== MediaSource.Youtube ||
      seed.url.length !== 11
    ) {
      return {
        songs,
        message: [resolutionMsg, "a mix is only available for YouTube tracks"]
          .filter(Boolean)
          .join(", "),
      };
    }

    // The seed takes one of the limit's slots. With no room left the request
    // still collapses to its seed: the cap is deliberate, so honoring both it
    // and the single-seed contract beats queueing the untouched input.
    const mixLimit = limit - 1;

    if (mixLimit <= 0) {
      return {
        songs: [seed],
        message: "the playlist limit left no room for a mix",
      };
    }

    const mix = await this.autoplay.getYouTubeMixSongs(seed, {
      limit: mixLimit,
      exclude: this.urlsInPlay(player, seed),
    });

    // A missing radio is an accident (yt-dlp hiccup, no mix for the video), not
    // a reason to throw away what the query did resolve.
    if (mix.length === 0) {
      return {
        songs,
        message: [resolutionMsg, "no mix was found for that track"]
          .filter(Boolean)
          .join(", "),
      };
    }

    logger.info(
      "queue",
      `mix seeded by "${seed.title}" added ${mix.length} track(s)`,
    );

    return {
      songs: [seed, ...mix],
      message:
        songs.length > 1 ? `a mix seeded by "${seed.title}" was queued` : "",
    };
  }

  // Everything the mix must not repeat. getQueue() starts after the current
  // track, so the playing song has to be listed on its own.
  private urlsInPlay(player: Player, seed: SongMetadata): Set<string> {
    const current = player.getCurrent();

    return new Set([
      seed.url,
      ...(current ? [current.url] : []),
      ...player.getQueue().map((song) => song.url),
    ]);
  }

  private addSongsToQueue({
    newSongs,
    addToFrontOfQueue,
    player,
    interaction,
  }: {
    newSongs: SongMetadata[];
    addToFrontOfQueue: boolean;
    player: Player;
    interaction: ChatInputCommandInteraction;
  }): void {
    // player.add({ immediate }) inserts each song right after the current one,
    // so adding a multi-song batch front-first would reverse it. Enqueue in
    // reverse for front insertion to keep the queue in newSongs order. Playlist
    // songs always append (add ignores immediate for them), so skip reversal.
    const enqueueOrder =
      addToFrontOfQueue && !newSongs.some((song) => song.playlist)
        ? [...newSongs].reverse()
        : newSongs;

    enqueueOrder.forEach((song) => {
      player.add(
        {
          ...song,
          addedInChannelId: interaction.channelId,
          requestedBy: getMemberUserId(interaction),
        },
        { immediate: addToFrontOfQueue },
      );
    });
  }

  private async connectAndPlay(
    player: Player,
    targetVoiceChannel: Parameters<Player["connect"]>[0],
    interaction: ChatInputCommandInteraction,
    wasPlayingSong: boolean,
    extraMsg: string,
  ): Promise<string> {
    let statusMsg = "";

    if (player.voiceConnection === null) {
      await player.connect(targetVoiceChannel);

      // Resume / start playback
      await player.play();

      if (wasPlayingSong) {
        statusMsg = "resuming playback";
      }

      await interaction.editReply({
        embeds: [buildPlayingMessageEmbed(player)],
      });
    } else if (player.status === STATUS.IDLE) {
      // Player is idle, start playback instead
      await player.play();
    }

    // Build status prefix for response message
    if (statusMsg !== "") {
      if (extraMsg === "") {
        extraMsg = statusMsg;
      } else {
        extraMsg = `${statusMsg}, ${extraMsg}`;
      }
    }

    return extraMsg;
  }

  private async buildQueueReply(
    interaction: ChatInputCommandInteraction,
    newSongs: SongMetadata[],
    firstSong: SongMetadata,
    addToFrontOfQueue: boolean,
    skipCurrentTrack: boolean,
    extraMsg: string,
  ): Promise<void> {
    let msg = extraMsg;
    if (msg !== "") {
      msg = ` (${msg})`;
    }

    if (newSongs.length === 1) {
      await interaction.editReply(
        `hai, **${firstSong.title}** added to the${addToFrontOfQueue ? " front of the" : ""} queue${skipCurrentTrack ? " and current track skipped" : ""}${msg}`,
      );
    } else {
      await interaction.editReply(
        `hai, **${firstSong.title}** and ${newSongs.length - 1} other songs were added to the${addToFrontOfQueue ? " front of the" : ""} queue${skipCurrentTrack ? " and current track skipped" : ""}${msg}`,
      );
    }
  }

  private async skipNonMusicSegments(song: SongMetadata) {
    if (
      !this.sponsorBlock ||
      (this.sponsorBlockDisabledUntil &&
        new Date() < this.sponsorBlockDisabledUntil) ||
      song.source !== MediaSource.Youtube ||
      !song.url
    ) {
      return song;
    }

    try {
      return await this.fetchAndApplySegments(song);
    } catch (e) {
      if (!(e instanceof Error)) {
        logger.error(
          "queue",
          "unexpected error while fetching skip segments:",
          e,
        );
        return song;
      }

      if (!e.message.includes("404")) {
        // Don't log 404 response, it just means that there are no segments for given video
        logger.warn(
          "queue",
          `could not fetch skip segments for "${song.url}":`,
          e,
        );
      }

      if (e.message.includes("504")) {
        // Stop fetching SponsorBlock data when servers are down
        this.sponsorBlockDisabledUntil = new Date(
          Date.now() + this.sponsorBlockTimeoutDelay * 60_000,
        );
      }

      return song;
    }
  }

  private async fetchAndApplySegments(
    song: SongMetadata,
  ): Promise<SongMetadata> {
    const segments =
      (await this.cache.wrap(
        async () =>
          this.sponsorBlock?.getSegments(song.url, ["music_offtopic"]),
        {
          key: song.url, // Value is too short for hashing
          expiresIn: ONE_HOUR_IN_SECONDS,
        },
      )) ?? [];
    const skipSegments = segments
      .sort((a, b) => a.startTime - b.startTime)
      .reduce(
        (
          acc: Array<{ startTime: number; endTime: number }>,
          { startTime, endTime },
        ) => {
          const previousSegment = acc[acc.length - 1];
          // If segments overlap merge
          if (previousSegment && previousSegment.endTime > startTime) {
            previousSegment.endTime = endTime;
          } else {
            acc.push({ startTime, endTime });
          }

          return acc;
        },
        [],
      );

    const intro = skipSegments[0];
    const outro = skipSegments.at(-1);
    if (outro && outro?.endTime >= song.length - 2) {
      song.length -= outro.endTime - outro.startTime;
    }

    if (intro && intro.startTime <= 2) {
      song.offset = Math.floor(intro.endTime);
      song.length -= song.offset;
    }

    return song;
  }
}
