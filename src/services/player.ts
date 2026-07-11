import type { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type AudioPlayer,
  type AudioPlayerState,
  AudioPlayerStatus,
  type AudioResource,
  createAudioPlayer,
  createAudioResource,
  type DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  StreamType,
  type VoiceConnection,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import shuffle from "array-shuffle";
import type { Snowflake, VoiceChannel } from "discord.js";
import ffmpeg from "fluent-ffmpeg";
import { WriteStream } from "fs-capacitor";
import { hashSync } from "hasha";
import type { PlayerState, Setting } from "../db/schema.js";
import { buildPlayingMessageEmbed } from "../utils/build-embed.js";
import { getGuildSettings } from "../utils/get-guild-settings.js";
import logger from "../utils/logger.js";
import {
  clearPlayerState,
  type PlayerStateSnapshot,
  savePlayerState,
} from "../utils/player-state.js";
import {
  getSoundCloudMediaSource,
  getYouTubeMediaSource,
} from "../utils/yt-dlp.js";
import type Autoplay from "./autoplay.js";
import type FileCacheProvider from "./file-cache.js";

export enum MediaSource {
  Youtube,
  HLS,
  SoundCloud,
}

export interface QueuedPlaylist {
  title: string;
  source: string;
}

export interface SongMetadata {
  title: string;
  artist: string;
  url: string; // For YT, it's the video ID (not the full URI)
  length: number;
  offset: number;
  playlist: QueuedPlaylist | null;
  isLive: boolean;
  thumbnailUrl: string | null;
  source: MediaSource;
}
export interface QueuedSong extends SongMetadata {
  addedInChannelId: Snowflake;
  requestedBy: string;
}

export enum STATUS {
  PLAYING,
  PAUSED,
  IDLE,
}

export interface PlayerEvents {
  statusChange: (oldStatus: STATUS, newStatus: STATUS) => void;
}

export const DEFAULT_VOLUME = 100;

// How many similar tracks to enqueue each time autoplay refills an empty queue.
const AUTOPLAY_BATCH = 10;

// Buffer a small cushion of transcoded audio before starting playback so a
// brief source/network stall at the start of a track doesn't cause a dropout.
// Capped by PREBUFFER_MAX_WAIT_MS so a slow or dead source can't hang playback.
const PREBUFFER_BYTES = 128 * 1024;
const PREBUFFER_MAX_WAIT_MS = 8_000;

// ffmpeg input flags that keep an HTTP(S) source alive on a flaky link:
// reconnect on drops, stalls, and transient HTTP errors, and time out a
// silently stalled socket (value in microseconds) so playback recovers instead
// of hanging until the player starves and skips the track.
const STREAM_RECONNECT_OPTIONS = [
  "-reconnect",
  "1",
  "-reconnect_streamed",
  "1",
  "-reconnect_on_network_error",
  "1",
  "-reconnect_on_http_error",
  "4xx,5xx",
  "-reconnect_delay_max",
  "5",
  "-rw_timeout",
  "30000000",
];

type FfmpegCommand = ReturnType<typeof ffmpeg>;

export default class {
  public voiceConnection: VoiceConnection | null = null;
  public status = STATUS.PAUSED;
  public guildId: string;
  public loopCurrentSong = false;
  public loopCurrentQueue = false;
  private currentChannel: VoiceChannel | undefined;
  private queue: QueuedSong[] = [];
  private queuePosition = 0;
  private audioPlayer: AudioPlayer | null = null;
  private audioResource: AudioResource | null = null;
  private volume?: number;
  private defaultVolume: number = DEFAULT_VOLUME;
  private pendingVolumeRebuild = false;
  private nowPlaying: QueuedSong | null = null;
  private playPositionInterval: NodeJS.Timeout | undefined;
  private lastSongURL = "";

  private positionInSeconds = 0;
  private readonly fileCache: FileCacheProvider;
  private readonly autoplay: Autoplay | undefined;
  private disconnectTimer: NodeJS.Timeout | null = null;

  private readonly channelToSpeakingUsers: Map<string, Set<string>> = new Map();
  private hasRegisteredVoiceActivityListener = false;
  private persistenceFrozen = false;

  constructor(
    fileCache: FileCacheProvider,
    guildId: string,
    autoplay?: Autoplay,
  ) {
    this.fileCache = fileCache;
    this.guildId = guildId;
    this.autoplay = autoplay;
  }

  async connect(channel: VoiceChannel): Promise<void> {
    if (this.voiceConnection) {
      this.disconnect();
    }

    // Always get freshest default volume setting value
    const settings = await getGuildSettings(this.guildId);
    const { defaultVolume = DEFAULT_VOLUME } = settings;
    this.defaultVolume = defaultVolume;

    const voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      selfDeaf: false,
      adapterCreator: channel.guild
        .voiceAdapterCreator as DiscordGatewayAdapterCreator,
    });

    this.voiceConnection = voiceConnection;
    this.currentChannel = channel;
    this.hasRegisteredVoiceActivityListener = false;

    const guildSettings = await getGuildSettings(this.guildId);
    const stateTransitions = [voiceConnection.state.status];
    this.registerVoiceConnectionListeners(
      voiceConnection,
      guildSettings,
      stateTransitions,
    );

    try {
      await this.waitForVoiceConnectionReady(voiceConnection);
    } catch {
      const { status } = voiceConnection.state;
      voiceConnection.destroy();
      this.voiceConnection = null;
      throw new Error(
        `Failed to connect to the voice channel (last state: ${status}, rejoin attempts: ${voiceConnection.rejoinAttempts}, recent states: ${stateTransitions.join(" -> ")}).`,
      );
    }
    this.save();
  }

  private registerVoiceConnectionListeners(
    voiceConnection: VoiceConnection,
    guildSettings: Setting,
    stateTransitions: VoiceConnectionStatus[],
  ): void {
    voiceConnection.on("stateChange", (oldState, newState) => {
      stateTransitions.push(newState.status);
      if (stateTransitions.length > 10) {
        stateTransitions.shift();
      }
      logger.debug(
        "player",
        `voice connection state changed: ${oldState.status} -> ${newState.status}`,
      );

      if (
        newState.status === VoiceConnectionStatus.Ready &&
        !this.hasRegisteredVoiceActivityListener
      ) {
        this.registerVoiceActivityListener(guildSettings);
        this.hasRegisteredVoiceActivityListener = true;
      }
    });

    voiceConnection.on(
      VoiceConnectionStatus.Disconnected,
      this.onVoiceConnectionDisconnect.bind(this),
    );
  }

  // Map a position within the logical track to ffmpeg seek/to bounds, honoring a
  // chapter `offset`. Shared by fresh starts (position 0) and seeks.
  private trackBounds(
    song: QueuedSong,
    position: number,
  ): { seek: number; to: number } {
    return {
      seek: song.offset + position,
      to: song.offset + song.length,
    };
  }

  disconnect(): void {
    if (this.voiceConnection) {
      if (this.status === STATUS.PLAYING) {
        this.pause();
      }

      this.loopCurrentSong = false;
      this.voiceConnection.destroy();
      this.audioPlayer?.stop(true);

      this.voiceConnection = null;
      this.audioPlayer = null;
      this.audioResource = null;
      this.currentChannel = undefined;
      this.channelToSpeakingUsers.clear();
      this.hasRegisteredVoiceActivityListener = false;
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    this.status = STATUS.PAUSED;

    const voiceConnection = await this.ensureVoiceConnectionReady();

    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error("No song currently playing");
    }

    if (positionSeconds > currentSong.length) {
      throw new Error("Seek position is outside the range of the song.");
    }

    const { seek, to } = this.trackBounds(currentSong, positionSeconds);
    const stream = await this.getStream(currentSong, { seek, to });
    const inlineVolume = await this.shouldInlineVolume();
    this.audioPlayer = createAudioPlayer({
      behaviors: {
        // Needs to be somewhat high for livestreams
        maxMissedFrames: 50,
      },
    });
    voiceConnection.subscribe(this.audioPlayer);
    this.playAudioPlayerResource(this.createAudioStream(stream, inlineVolume));
    this.attachListeners();
    this.startTrackingPosition(positionSeconds);

    this.status = STATUS.PLAYING;
    this.save();
  }

  async forwardSeek(positionSeconds: number): Promise<void> {
    return this.seek(this.positionInSeconds + positionSeconds);
  }

  getPosition(): number {
    return this.positionInSeconds;
  }

  async play(): Promise<void> {
    const voiceConnection = await this.ensureVoiceConnectionReady();

    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error("Queue empty.");
    }

    // Cancel any pending idle disconnection
    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    // Resume from paused state
    if (
      this.status === STATUS.PAUSED &&
      currentSong.url === this.nowPlaying?.url
    ) {
      if (this.audioPlayer && !this.pendingVolumeRebuild) {
        this.audioPlayer.unpause();
        this.status = STATUS.PLAYING;
        this.startTrackingPosition();
        this.save();
        return;
      }

      // Disconnected, or volume mode changed while paused: recreate the stream
      if (!currentSong.isLive) {
        return this.seek(this.getPosition());
      }
    }

    await this.startFreshStream(voiceConnection, currentSong);
  }

  private async startFreshStream(
    voiceConnection: VoiceConnection,
    currentSong: QueuedSong,
  ): Promise<void> {
    try {
      const { seek, to } = this.trackBounds(currentSong, 0);
      const stream = await this.getStream(currentSong, { seek, to });
      const inlineVolume = await this.shouldInlineVolume();
      this.audioPlayer = createAudioPlayer({
        behaviors: {
          // Needs to be somewhat high for livestreams
          maxMissedFrames: 50,
        },
      });
      voiceConnection.subscribe(this.audioPlayer);
      this.playAudioPlayerResource(
        this.createAudioStream(stream, inlineVolume),
      );

      this.attachListeners();

      this.status = STATUS.PLAYING;
      this.nowPlaying = currentSong;

      logger.info(
        "player",
        `now playing "${currentSong.title}" [${this.queuePosition + 1}/${this.queue.length}]`,
      );

      if (currentSong.url === this.lastSongURL) {
        this.startTrackingPosition();
      } else {
        // Reset position counter
        this.startTrackingPosition(0);
        this.lastSongURL = currentSong.url;
      }
      this.save();
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);

      // A single unplayable track shouldn't halt the queue or surface to the
      // caller as a command error. If a later track exists, skip to it and treat
      // the failure as recovered; otherwise stop and surface the error.
      if (this.getQueue().length === 0) {
        logger.error(
          "player",
          `"${currentSong.title}" failed to start and the queue is empty: ${reason}`,
        );
        await this.finishQueue();
        throw error;
      }

      logger.warn(
        "player",
        `"${currentSong.title}" failed to start, skipping to next track: ${reason}`,
      );
      await this.forward(1);
    }
  }

  pause(): void {
    if (this.status !== STATUS.PLAYING) {
      throw new Error("Not currently playing.");
    }

    this.status = STATUS.PAUSED;

    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    this.stopTrackingPosition();
    this.save();
  }

  async forward(skip: number): Promise<void> {
    const previousPosition = this.queuePosition;
    const previousPositionInSeconds = this.positionInSeconds;
    this.manualForward(skip);

    try {
      if (this.getCurrent()) {
        // Advancing to a queued track always resumes playback, so /skip and
        // the add-and-skip path start the next song even from a paused player
        // instead of staying paused.
        await this.play();
      } else if (await this.tryAutoplay()) {
        // Queue ran out — autoplay refilled it at the current position, so
        // play it regardless of the previous pause state.
        await this.play();
      } else {
        await this.finishQueue();
      }
    } catch (error: unknown) {
      // Starting the new track failed — restore the pre-skip position so a
      // skip that can't play doesn't strand the player mid-queue.
      this.queuePosition = previousPosition;
      this.positionInSeconds = previousPositionInSeconds;
      this.save();
      throw error;
    }
  }

  registerVoiceActivityListener(guildSettings: Setting) {
    const {
      turnDownVolumeWhenPeopleSpeak,
      turnDownVolumeWhenPeopleSpeakTarget,
    } = guildSettings;
    if (!turnDownVolumeWhenPeopleSpeak || !this.voiceConnection) {
      return;
    }

    this.voiceConnection.receiver.speaking.on("start", (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel?.id;

      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.add(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(
        turnDownVolumeWhenPeopleSpeakTarget,
      );
    });

    this.voiceConnection.receiver.speaking.on("end", (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel.id;
      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.delete(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(
        turnDownVolumeWhenPeopleSpeakTarget,
      );
    });
  }

  suppressVoiceWhenPeopleAreSpeaking(
    turnDownVolumeWhenPeopleSpeakTarget: number,
  ): void {
    if (!this.currentChannel) {
      return;
    }

    const speakingUsers = this.channelToSpeakingUsers.get(
      this.currentChannel.id,
    );
    if (speakingUsers && speakingUsers.size > 0) {
      this.setVolume(turnDownVolumeWhenPeopleSpeakTarget);
    } else {
      this.setVolume(this.defaultVolume);
    }
  }

  canGoForward(skip: number) {
    return this.queuePosition + skip - 1 < this.queue.length;
  }

  manualForward(skip: number): void {
    if (this.canGoForward(skip)) {
      const from = this.queuePosition;
      this.queuePosition += skip;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
      logger.debug(
        "player",
        `queue position ${from} -> ${this.queuePosition} (forward ${skip})`,
      );
      this.save();
    } else {
      throw new Error("No songs in queue to forward to.");
    }
  }

  canGoBack() {
    return this.queuePosition - 1 >= 0;
  }

  async back(): Promise<void> {
    if (this.canGoBack()) {
      const from = this.queuePosition;
      this.queuePosition--;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
      logger.debug(
        "player",
        `queue position ${from} -> ${this.queuePosition} (back)`,
      );
      this.save();

      if (this.status !== STATUS.PAUSED) {
        await this.play();
      }
    } else {
      throw new Error("No songs in queue to go back to.");
    }
  }

  getCurrent(): QueuedSong | null {
    return this.queue[this.queuePosition] ?? null;
  }

  /**
   * Returns queue, not including the current song.
   * @returns {QueuedSong[]}
   */
  getQueue(): QueuedSong[] {
    return this.queue.slice(this.queuePosition + 1);
  }

  add(song: QueuedSong, { immediate = false } = {}): void {
    if (song.playlist || !immediate) {
      // Add to end of queue
      this.queue.push(song);
    } else {
      // Add as the next song to be played
      const insertAt = this.queuePosition + 1;
      this.queue = [
        ...this.queue.slice(0, insertAt),
        song,
        ...this.queue.slice(insertAt),
      ];
    }
    this.save();
  }

  shuffle(): void {
    const shuffledSongs = shuffle(this.queue.slice(this.queuePosition + 1));

    this.queue = [
      ...this.queue.slice(0, this.queuePosition + 1),
      ...shuffledSongs,
    ];
    this.save();
  }

  clear(): void {
    const newQueue = [];

    // Don't clear curently playing song
    const current = this.getCurrent();

    if (current) {
      newQueue.push(current);
    }

    this.queuePosition = 0;
    this.queue = newQueue;
    this.save();
  }

  removeFromQueue(index: number, amount = 1): void {
    this.queue.splice(this.queuePosition + index, amount);
    this.save();
  }

  removeCurrent(): void {
    this.queue = [
      ...this.queue.slice(0, this.queuePosition),
      ...this.queue.slice(this.queuePosition + 1),
    ];
    this.save();
  }

  queueSize(): number {
    return this.getQueue().length;
  }

  isQueueEmpty(): boolean {
    return this.queueSize() === 0;
  }

  stop(): void {
    this.disconnect();
    this.queuePosition = 0;
    this.queue = [];
    this.forget();
  }

  move(from: number, to: number): QueuedSong {
    if (from > this.queueSize() || to > this.queueSize()) {
      throw new Error("Move index is outside the range of the queue.");
    }

    const [song] = this.queue.splice(this.queuePosition + from, 1);
    if (!song) {
      throw new Error("Move index is outside the range of the queue.");
    }

    this.queue.splice(this.queuePosition + to, 0, song);

    this.save();
    return song;
  }

  setVolume(level: number): void {
    // Level should be a number between 0 and 100 = 0% => 100%
    this.volume = level;
    this.setAudioPlayerVolume(level);
    this.save();
    this.reconcileVolumeMode(level);
  }

  getVolume(): number {
    // Only use default volume if player volume is not already set (in the event of a reconnect we shouldn't reset)
    return this.volume ?? this.defaultVolume;
  }

  // ffmpeg already encodes Opus; with volume at 100 and ducking off we hand the
  // packets straight to Discord (inlineVolume false) instead of paying for a
  // decode/volume/re-encode per frame. The transformer is only needed when the
  // level differs from 100 or the guild ducks volume on speech.
  private async shouldInlineVolume(): Promise<boolean> {
    const { turnDownVolumeWhenPeopleSpeak } = await getGuildSettings(
      this.guildId,
    );
    return turnDownVolumeWhenPeopleSpeak || this.getVolume() !== 100;
  }

  // A pass-through resource carries no VolumeTransformer, so a non-unity gain
  // can't apply until the resource is rebuilt with inlineVolume. Rebuild in
  // place while playing; defer to the resume path when currently paused.
  private reconcileVolumeMode(level: number): void {
    const isPassthrough =
      this.audioResource !== null && !this.audioResource.volume;
    if (level === 100 || !isPassthrough) {
      return;
    }

    if (this.status === STATUS.PLAYING) {
      void this.seek(this.getPosition()).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error("player", `failed to apply volume change: ${reason}`);
      });
    } else if (this.status === STATUS.PAUSED) {
      this.pendingVolumeRebuild = true;
    }
  }

  private getCacheKey(song: QueuedSong): string {
    // Chapter splits share one video URL but cover different segments. The cache
    // stores ffmpeg's `-to`-bounded output, so keying only by URL means the first
    // chapter's truncated audio is reused for every later chapter (which then seek
    // past its end and play nothing). Include the segment bounds in the key.
    return `${song.url}:${song.offset}:${song.length}`;
  }

  private getHashForCache(url: string): string {
    return hashSync(url, { algorithm: "sha512" });
  }

  private async getStream(
    song: QueuedSong,
    options: { seek?: number | undefined; to?: number | undefined } = {},
  ): Promise<Readable> {
    if (this.status === STATUS.PLAYING || this.status === STATUS.PAUSED) {
      // This stop() deliberately tears down the current stream so a new one can
      // take over (skip/back/seek). The old player still has the auto-advance
      // `Idle` listener attached, and stop() emits `Idle` synchronously — unless
      // we detach it first, that handler fires an extra forward(1) and skips a
      // track. The replacement player re-attaches its own via attachListeners().
      this.audioPlayer?.removeAllListeners(AudioPlayerStatus.Idle);
      this.audioPlayer?.stop(this.status === STATUS.PAUSED);
    }

    if (song.source === MediaSource.HLS) {
      return this.createReadStream({ url: song.url, cacheKey: song.url });
    }

    // YouTube and SoundCloud both resolve to a streamable URL via yt-dlp.
    const { ffmpegInput, ffmpegInputOptions, shouldCacheVideo } =
      await this.resolveYtDlpInput(song, options);

    return this.createReadStream({
      url: ffmpegInput,
      cacheKey: this.getCacheKey(song),
      ffmpegInputOptions,
      cache: shouldCacheVideo,
    });
  }

  private async resolveYtDlpInput(
    song: QueuedSong,
    options: { seek?: number | undefined; to?: number | undefined },
  ): Promise<{
    ffmpegInput: string;
    ffmpegInputOptions: string[];
    shouldCacheVideo: boolean;
  }> {
    const ffmpegInputOptions: string[] = [];
    let shouldCacheVideo = false;

    let ffmpegInput = await this.fileCache.getPathFor(
      this.getHashForCache(this.getCacheKey(song)),
    );

    if (!ffmpegInput) {
      const mediaSource =
        song.source === MediaSource.SoundCloud
          ? await getSoundCloudMediaSource(song.url)
          : await getYouTubeMediaSource(song.url);
      ffmpegInput = mediaSource.url;

      // Don't cache livestreams or long videos
      const MAX_CACHE_LENGTH_SECONDS = 30 * 60; // 30 minutes
      shouldCacheVideo =
        !mediaSource.isLive &&
        song.length < MAX_CACHE_LENGTH_SECONDS &&
        !options.seek;

      logger.debug(
        "player",
        shouldCacheVideo
          ? `caching video for "${song.title}"`
          : `not caching video for "${song.title}"`,
      );

      ffmpegInputOptions.push(...STREAM_RECONNECT_OPTIONS);

      const headerOptions = this.buildFfmpegHeaderOptions(mediaSource.headers);
      ffmpegInputOptions.push(...headerOptions);
    }

    if (options.seek) {
      ffmpegInputOptions.push("-ss", options.seek.toString());
    }

    if (options.to) {
      ffmpegInputOptions.push("-to", options.to.toString());
    }

    return { ffmpegInput, ffmpegInputOptions, shouldCacheVideo };
  }

  private startTrackingPosition(initalPosition?: number): void {
    if (initalPosition !== undefined) {
      this.positionInSeconds = initalPosition;
    }

    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }

    this.playPositionInterval = setInterval(() => {
      this.positionInSeconds++;
      // Persist position periodically so a crash mid-track resumes close to
      // where it left off (a graceful shutdown flushes the exact position).
      if (this.positionInSeconds % 15 === 0) {
        this.save();
      }
    }, 1000);
  }

  private stopTrackingPosition(): void {
    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }
  }

  private attachListeners(): void {
    if (!this.voiceConnection) {
      return;
    }

    if (!this.audioPlayer) {
      return;
    }

    if (this.audioPlayer.listeners("stateChange").length === 0) {
      this.audioPlayer.on(
        AudioPlayerStatus.Idle,
        this.onAudioPlayerIdle.bind(this),
      );
    }
  }

  private async onVoiceConnectionDisconnect(): Promise<void> {
    if (
      !this.voiceConnection ||
      this.voiceConnection.state.status !== VoiceConnectionStatus.Disconnected
    ) {
      return;
    }

    const disconnectedState = this.voiceConnection.state;
    if (
      disconnectedState.reason ===
        VoiceConnectionDisconnectReason.WebSocketClose &&
      disconnectedState.closeCode === 4014
    ) {
      try {
        await Promise.race([
          entersState(
            this.voiceConnection,
            VoiceConnectionStatus.Connecting,
            5_000,
          ),
          entersState(
            this.voiceConnection,
            VoiceConnectionStatus.Signalling,
            5_000,
          ),
        ]);
        return;
      } catch {
        this.disconnect();
        return;
      }
    }

    if (this.voiceConnection.rejoinAttempts < 5) {
      await sleep((this.voiceConnection.rejoinAttempts + 1) * 5_000);

      if (
        this.voiceConnection &&
        this.voiceConnection.state.status === VoiceConnectionStatus.Disconnected
      ) {
        if (this.voiceConnection.rejoin()) {
          return;
        }
      }
    }

    this.disconnect();
  }

  private async ensureVoiceConnectionReady(): Promise<VoiceConnection> {
    if (this.voiceConnection === null) {
      throw new Error("Not connected to a voice channel.");
    }

    await this.waitForVoiceConnectionReady(this.voiceConnection);

    return this.voiceConnection;
  }

  private async waitForVoiceConnectionReady(
    voiceConnection: VoiceConnection,
  ): Promise<void> {
    await entersState(voiceConnection, VoiceConnectionStatus.Ready, 60_000);
  }

  private async onAudioPlayerIdle(
    _oldState: AudioPlayerState,
    newState: AudioPlayerState,
  ): Promise<void> {
    // Automatically advance queued song at end
    if (
      this.loopCurrentSong &&
      newState.status === AudioPlayerStatus.Idle &&
      this.status === STATUS.PLAYING
    ) {
      await this.seek(0);
      return;
    }

    // Automatically re-add current song to queue
    if (
      this.loopCurrentQueue &&
      newState.status === AudioPlayerStatus.Idle &&
      this.status === STATUS.PLAYING
    ) {
      const currentSong = this.getCurrent();

      if (currentSong) {
        this.add(currentSong);
      } else {
        throw new Error("No song currently playing.");
      }
    }

    if (
      newState.status === AudioPlayerStatus.Idle &&
      this.status === STATUS.PLAYING
    ) {
      logger.debug("player", "track ended, advancing to next");
      // forward() advances to the next song, refills via autoplay, or finishes
      // the queue. Announce only when something is actually playing afterwards.
      await this.forward(1);
      if (!this.getCurrent()) {
        return;
      }

      await this.announceNowPlaying();
    }
  }

  /**
   * When the queue empties, seed more music similar to the track that just
   * finished and keep playing (radio mode). Controlled per-guild by the
   * `autoplay` setting. Returns true if playback continued, false if the caller
   * should fall back to the normal end-of-queue behavior.
   */
  private async tryAutoplay(): Promise<boolean> {
    if (!this.autoplay) {
      return false;
    }

    const settings = await getGuildSettings(this.guildId);
    if (!settings.autoplay) {
      return false;
    }

    // forward() advances past the end of the queue before calling us, so the
    // seed is the track we just left (the last song in the queue).
    const seed = this.getCurrent() ?? this.queue[this.queuePosition - 1];
    if (!seed) {
      return false;
    }

    try {
      // Exclude everything already queued this session so we don't loop.
      const exclude = new Set(this.queue.map((song) => song.url));
      const related = await this.autoplay.getRelatedSongs(seed, {
        limit: AUTOPLAY_BATCH,
        exclude,
      });

      if (related.length === 0) {
        return false;
      }

      for (const song of related) {
        this.add({
          ...song,
          addedInChannelId: seed.addedInChannelId,
          requestedBy: seed.requestedBy,
        });
      }

      // The new tracks land at the current (past-the-end) position, so the
      // caller can start playback without advancing the queue further.
      logger.info(
        "player",
        `autoplay queued ${related.length} track(s) similar to "${seed.title}"`,
      );

      return true;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn("player", `autoplay failed: ${reason}`);
      return false;
    }
  }

  /**
   * Announce the current track if the guild has `autoAnnounceNextSong` enabled.
   * Posts to the text channel where the track was requested (`/play`), falling
   * back to the voice channel's chat if that channel is gone. Shared by normal
   * queue advances and autoplay so both honor the same setting and channel.
   */
  private async announceNowPlaying(): Promise<void> {
    const settings = await getGuildSettings(this.guildId);
    if (!settings.autoAnnounceNextSong) {
      return;
    }

    const message = { embeds: [buildPlayingMessageEmbed(this)] };
    const requestedChannelId = this.getCurrent()?.addedInChannelId;
    const requestedChannel = requestedChannelId
      ? this.currentChannel?.guild.channels.cache.get(requestedChannelId)
      : undefined;

    if (requestedChannel?.isTextBased()) {
      await requestedChannel.send(message);
      return;
    }

    // Fall back to the voice channel's chat if the request channel is gone.
    await this.currentChannel?.send(message);
  }

  private async finishQueue(): Promise<void> {
    logger.info("player", "reached end of queue");
    this.status = STATUS.IDLE;
    this.audioPlayer?.stop(true);
    this.save();

    const settings = await getGuildSettings(this.guildId);

    const { secondsToWaitAfterQueueEmpties } = settings;
    if (secondsToWaitAfterQueueEmpties !== 0) {
      this.disconnectTimer = setTimeout(() => {
        // Make sure we are not accidentally playing
        // when disconnecting
        if (this.status === STATUS.IDLE) {
          this.disconnect();
          this.forget();
        }
      }, secondsToWaitAfterQueueEmpties * 1000);
    }
  }

  private buildFfmpegHeaderOptions(headers: Record<string, string>) {
    const headerLines = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");

    if (!headerLines) {
      return [];
    }

    return ["-headers", `${headerLines}\r\n`];
  }

  private async createReadStream(options: {
    url: string;
    cacheKey: string;
    ffmpegInputOptions?: string[];
    cache?: boolean;
  }): Promise<Readable> {
    const capacitor = new WriteStream();

    if (options?.cache) {
      const cacheStream = this.fileCache.createWriteStream(
        this.getHashForCache(options.cacheKey),
      );
      capacitor.createReadStream().pipe(cacheStream);
    }

    const stream = this.transcodeToOpus(
      options.url,
      options.ffmpegInputOptions,
    );
    stream.pipe(capacitor);

    return this.prebufferedStream(capacitor, stream, Boolean(options.cache));
  }

  private transcodeToOpus(
    url: string,
    inputOptions: string[] | undefined,
  ): FfmpegCommand {
    return ffmpeg(url)
      .inputOptions(inputOptions ?? ["-re"])
      .noVideo()
      .audioCodec("libopus")
      .outputFormat("webm")
      .on("start", (command) => {
        logger.debug("player", `spawned ffmpeg with ${command}`);
      });
  }

  // Resolve a playable read stream once ffmpeg has buffered a cushion (see
  // monitorPrebuffer), rejecting only if ffmpeg errors before playback starts.
  private prebufferedStream(
    capacitor: WriteStream,
    stream: FfmpegCommand,
    cache: boolean,
  ): Promise<Readable> {
    const returnedStream = capacitor.createReadStream();

    return new Promise((resolve, reject) => {
      let settled = false;

      stream.on("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      returnedStream.on("close", () => {
        if (!cache) {
          stream.kill("SIGKILL");
        }
      });

      this.monitorPrebuffer(capacitor, () => {
        if (!settled) {
          settled = true;
          resolve(returnedStream);
        }
      });
    });
  }

  // Meter ffmpeg output via a throwaway read stream and call `onReady` once a
  // cushion is buffered, the input ends (short track), or the cap elapses so a
  // slow source can't stall startup.
  private monitorPrebuffer(capacitor: WriteStream, onReady: () => void): void {
    const monitor = capacitor.createReadStream();
    let buffered = 0;
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }

      done = true;
      clearTimeout(timer);
      monitor.destroy();
      onReady();
    };
    const timer = setTimeout(finish, PREBUFFER_MAX_WAIT_MS);
    monitor.on("data", (chunk: Buffer) => {
      buffered += chunk.length;
      if (buffered >= PREBUFFER_BYTES) {
        finish();
      }
    });
    monitor.on("end", finish);
    monitor.on("error", finish);
  }

  private createAudioStream(stream: Readable, inlineVolume: boolean) {
    return createAudioResource(stream, {
      inputType: StreamType.WebmOpus,
      inlineVolume,
    });
  }

  private playAudioPlayerResource(resource: AudioResource) {
    if (this.audioPlayer !== null) {
      this.audioResource = resource;
      this.pendingVolumeRebuild = false;
      this.setAudioPlayerVolume();
      this.audioPlayer.play(this.audioResource);
    }
  }

  private setAudioPlayerVolume(level?: number) {
    // Audio resource expects a float between 0 and 1 to represent level percentage
    this.audioResource?.volume?.setVolume((level ?? this.getVolume()) / 100);
  }

  serialize(): PlayerStateSnapshot {
    return {
      guildId: this.guildId,
      voiceChannelId: this.currentChannel?.id ?? null,
      queue: this.queue,
      queuePosition: this.queuePosition,
      positionInSeconds: this.positionInSeconds,
      status: this.status,
      loopCurrentSong: this.loopCurrentSong,
      loopCurrentQueue: this.loopCurrentQueue,
      volume: this.volume ?? null,
    };
  }

  // Restore queue and position from a persisted snapshot. The current song is
  // primed as PAUSED so a later play()/seek() resumes at the saved position via
  // the reconnect path; the caller decides whether to auto-resume playback.
  restoreState(state: PlayerState): void {
    this.queue = state.queue;
    this.queuePosition = state.queuePosition;
    this.positionInSeconds = state.positionInSeconds;
    this.loopCurrentSong = state.loopCurrentSong;
    this.loopCurrentQueue = state.loopCurrentQueue;
    if (state.volume !== null) {
      this.volume = state.volume;
    }

    const current = this.getCurrent();
    if (current && state.status !== STATUS.IDLE) {
      this.nowPlaying = current;
      this.lastSongURL = current.url;
      this.status = STATUS.PAUSED;
    } else {
      this.status = STATUS.IDLE;
    }
  }

  // Persist the current snapshot. No-op once frozen for shutdown.
  private save(): void {
    if (this.persistenceFrozen) {
      return;
    }

    savePlayerState(this.serialize());
  }

  // Snapshot the live state (current status + exact position) and then freeze
  // persistence, so the shutdown teardown (disconnect -> pause) cannot overwrite
  // it. Called for every player right before disconnecting on shutdown.
  freezeAndSave(): void {
    if (this.persistenceFrozen) {
      return;
    }

    if (this.voiceConnection || this.queue.length > 0) {
      savePlayerState(this.serialize());
    }

    this.persistenceFrozen = true;
  }

  // Drop the persisted snapshot on an intentional stop/disconnect, so the bot
  // does not rejoin or resume after the user told it to leave.
  forget(): void {
    clearPlayerState(this.guildId);
  }

  // Leave the voice channel but keep the queue, persisting it without a channel
  // so a later /play resumes it and a restart restores the queue without
  // rejoining. Used by /disconnect and the empty-channel auto-leave.
  leave(): void {
    this.disconnect();
    this.save();
  }
}
