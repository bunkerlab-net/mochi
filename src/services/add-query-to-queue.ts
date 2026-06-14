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
import { getGuildSettings } from "../utils/get-guild-settings.js";
import { getGuild, getGuildId, getMemberUserId } from "../utils/interaction.js";
import type Config from "./config.js";
import type KeyValueCacheProvider from "./key-value-cache.js";
import type Player from "./player.js";
import { MediaSource, type SongMetadata, STATUS } from "./player.js";

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
    skipCurrentTrack,
    interaction,
  }: {
    query: string;
    addToFrontOfQueue: boolean;
    shuffleAdditions: boolean;
    shouldSplitChapters: boolean;
    skipCurrentTrack: boolean;
    interaction: ChatInputCommandInteraction;
  }): Promise<void> {
    const guildId = getGuildId(interaction);
    const player = this.playerManager.get(guildId);
    const wasPlayingSong = player.getCurrent() !== null;

    const [targetVoiceChannel] =
      getMemberVoiceChannel(interaction.member as GuildMember) ??
      getMostPopularVoiceChannel(getGuild(interaction));

    const {
      newSongs,
      firstSong,
      extraMsg: initialExtraMsg,
    } = await this.prepareAndEnqueueSongs({
      query,
      addToFrontOfQueue,
      shuffleAdditions,
      shouldSplitChapters,
      player,
      interaction,
    });

    const extraMsg = await this.connectAndPlay(
      player,
      targetVoiceChannel,
      interaction,
      wasPlayingSong,
      initialExtraMsg,
    );

    if (skipCurrentTrack) {
      try {
        await player.forward(1);
      } catch (_: unknown) {
        throw new Error("no song to skip to");
      }
    }

    await this.buildQueueReply(
      interaction,
      newSongs,
      firstSong,
      addToFrontOfQueue,
      skipCurrentTrack,
      extraMsg,
    );
  }

  private async prepareAndEnqueueSongs({
    query,
    addToFrontOfQueue,
    shuffleAdditions,
    shouldSplitChapters,
    player,
    interaction,
  }: {
    query: string;
    addToFrontOfQueue: boolean;
    shuffleAdditions: boolean;
    shouldSplitChapters: boolean;
    player: Player;
    interaction: ChatInputCommandInteraction;
  }): Promise<{
    newSongs: SongMetadata[];
    firstSong: SongMetadata;
    extraMsg: string;
  }> {
    const guildId = getGuildId(interaction);
    const settings = await getGuildSettings(guildId);
    const { playlistLimit, queueAddResponseEphemeral } = settings;

    await interaction.deferReply(
      queueAddResponseEphemeral ? { flags: MessageFlags.Ephemeral } : {},
    );

    let [newSongs, extraMsg] = await this.getSongs.getSongs(
      query,
      playlistLimit,
      shouldSplitChapters,
    );

    if (newSongs.length === 0) {
      throw new Error("no songs found");
    }

    if (shuffleAdditions) {
      newSongs = shuffle(newSongs);
    }

    if (this.config.ENABLE_SPONSORBLOCK) {
      newSongs = await Promise.all(
        newSongs.map(this.skipNonMusicSegments.bind(this)),
      );
    }

    newSongs.forEach((song) => {
      player.add(
        {
          ...song,
          addedInChannelId: interaction.channelId,
          requestedBy: getMemberUserId(interaction),
        },
        { immediate: addToFrontOfQueue ?? false },
      );
    });

    const firstSong = newSongs[0];
    if (!firstSong) {
      throw new Error("no songs found");
    }

    return { newSongs, firstSong, extraMsg };
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
        `u betcha, **${firstSong.title}** added to the${addToFrontOfQueue ? " front of the" : ""} queue${skipCurrentTrack ? "and current track skipped" : ""}${msg}`,
      );
    } else {
      await interaction.editReply(
        `u betcha, **${firstSong.title}** and ${newSongs.length - 1} other songs were added to the queue${skipCurrentTrack ? "and current track skipped" : ""}${msg}`,
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
        console.error(
          "Unexpected event occurred while fetching skip segments : ",
          e,
        );
        return song;
      }

      if (!e.message.includes("404")) {
        // Don't log 404 response, it just means that there are no segments for given video
        console.warn(`Could not fetch skip segments for "${song.url}" :`, e);
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
