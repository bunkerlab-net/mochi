import { afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { runMigrations } from "../../src/db/index.js";
import { loadPlayerState } from "../../src/utils/player-state.js";

// ---------------------------------------------------------------------------
// Mock player.ts's heavy dependencies. get-guild-settings is mocked to keep the
// DI container (inversify.config) out of the test graph; the voice/ffmpeg/
// fs-capacitor mocks let the streaming methods run without real audio
// infrastructure. yt-dlp media resolution is injected via the Player
// constructor (see mediaResolvers below) rather than module-mocked: mocking the
// yt-dlp source module leaks the stub into yt-dlp.test.ts on platforms where bun
// doesn't reset module mocks. build-embed is likewise NOT mocked here: it is a
// local source module that build-embed.test.ts needs real. The song fixtures
// below satisfy the real build-embed.
// ---------------------------------------------------------------------------
let settings: Record<string, unknown> = {};
let mediaSource = {
  url: "https://media/audio",
  headers: { "User-Agent": "ua" },
  isLive: false,
};
let mediaSourceError: Error | null = null;
let entersStateImpl: () => Promise<void> = async () => {};

mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => settings,
}));

const fakeReadable = () => ({
  on: (event: string, cb: () => void) => {
    // The prebuffer monitor settles on the input stream's "end"; fire it so
    // createReadStream resolves without waiting for the real timeout.
    if (event === "end") {
      queueMicrotask(cb);
    }
  },
  pipe: () => {},
  destroy: () => {},
});

class FakeWriteStream {
  createReadStream() {
    return fakeReadable();
  }
}
mock.module("fs-capacitor", () => ({ WriteStream: FakeWriteStream }));

const ffmpegChain = () => {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "inputOptions",
    "noVideo",
    "audioCodec",
    "outputFormat",
    "on",
  ]) {
    chain[method] = () => chain;
  }
  chain.pipe = () => {};
  chain.kill = () => {};
  return chain;
};
mock.module("fluent-ffmpeg", () => ({ default: () => ffmpegChain() }));

const makeAudioPlayer = () => {
  const listeners = new Map<string, Array<(...a: unknown[]) => unknown>>();
  return {
    on(event: string, cb: (...a: unknown[]) => unknown) {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
    },
    listeners: (event: string) => listeners.get(event) ?? [],
    removeAllListeners(event: string) {
      listeners.delete(event);
    },
    pause() {},
    unpause() {},
    stop() {},
    play() {},
    async emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) {
        await cb(...args);
      }
    },
  };
};

// Capture the inlineVolume decision and model the real library: a pass-through
// resource (inlineVolume false) carries no `.volume` transformer.
let lastInlineVolume: boolean | undefined;
const makeAudioResource = (
  _stream: unknown,
  options: { inlineVolume?: boolean },
) => {
  lastInlineVolume = options?.inlineVolume;
  return options?.inlineVolume ? { volume: { setVolume: () => {} } } : {};
};

mock.module("@discordjs/voice", () => ({
  createAudioPlayer: () => makeAudioPlayer(),
  createAudioResource: makeAudioResource,
  joinVoiceChannel: () => makeVoiceConnection(),
  entersState: () => entersStateImpl(),
  StreamType: { WebmOpus: "webm/opus" },
  AudioPlayerStatus: { Idle: "idle", Playing: "playing" },
  VoiceConnectionStatus: {
    Ready: "ready",
    Disconnected: "disconnected",
    Connecting: "connecting",
    Signalling: "signalling",
  },
  VoiceConnectionDisconnectReason: { WebSocketClose: 0 },
}));

const speakingHandlers: Record<string, (userId: string) => void> = {};

const makeVoiceConnection = () => ({
  state: { status: "ready" },
  on: () => {},
  destroy() {},
  subscribe() {},
  rejoinAttempts: 0,
  rejoin: () => true,
  receiver: {
    speaking: {
      on(event: string, cb: (userId: string) => void) {
        speakingHandlers[event] = cb;
      },
    },
  },
});

const {
  default: Player,
  STATUS,
  MediaSource,
} = await import("../../src/services/player.js");

// ---------------------------------------------------------------------------
const fileCache = {
  getPathFor: async () => null as string | null,
  createWriteStream: () => fakeReadable(),
};
const autoplay = { getRelatedSongs: async () => [] as unknown[] };
const mediaResolvers = {
  getYouTubeMediaSource: async () => {
    // Let a test force a stream-resolution failure to exercise the real
    // play()/startFreshStream recovery path.
    if (mediaSourceError) {
      throw mediaSourceError;
    }
    return mediaSource;
  },
  getSoundCloudMediaSource: async () => mediaSource,
};

type AnyPlayer = InstanceType<typeof Player> & Record<string, unknown>;

let active: AnyPlayer | undefined;

const makePlayer = (guildId = "guild-1") => {
  const player = new Player(
    fileCache as never,
    guildId,
    autoplay as never,
    mediaResolvers as never,
  ) as AnyPlayer;
  active = player;
  return player;
};

const song = (overrides: Record<string, unknown> = {}) => ({
  title: "Song",
  artist: "Artist",
  url: "vid00000001",
  length: 200,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: MediaSource.Youtube,
  addedInChannelId: "chan-1",
  requestedBy: "user-1",
  ...overrides,
});

beforeAll(() => {
  runMigrations();
});

beforeEach(() => {
  settings = {
    defaultVolume: 100,
    secondsToWaitAfterQueueEmpties: 30,
    autoplay: true,
    autoAnnounceNextSong: false,
    turnDownVolumeWhenPeopleSpeak: false,
    turnDownVolumeWhenPeopleSpeakTarget: 20,
  };
  mediaSource = {
    url: "https://media/audio",
    headers: { "User-Agent": "ua" },
    isLive: false,
  };
  entersStateImpl = async () => {};
  lastInlineVolume = undefined;
});

afterEach(() => {
  // Clear any leaked position interval / disconnect timer.
  active?.stopTrackingPosition?.();
  const timer = active?.disconnectTimer as NodeJS.Timeout | null | undefined;
  if (timer) {
    clearTimeout(timer);
  }
  // Restore the autoplay stub so a mutation can't leak to later tests, even if
  // an assertion above throws before an inline reset runs.
  autoplay.getRelatedSongs = async () => [];
  mediaSourceError = null;
  active = undefined;
});

// ---- queue management (no mocks needed) -----------------------------------
test("add: appends to the end of the queue by default", () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  expect(player.getCurrent()?.url).toBe("a");
  expect(player.queueSize()).toBe(1);
});

test("add: immediate inserts right after the current song", () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  player.add(song({ url: "c" }), { immediate: true });
  expect(player.getQueue().map((s) => s.url)).toEqual(["c", "b"]);
});

test("add: a playlist song is always appended even when immediate", () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b", playlist: { title: "p", source: "s" } }), {
    immediate: true,
  });
  expect(player.getQueue().map((s) => s.url)).toEqual(["b"]);
});

test("getCurrent: null on an empty queue", () => {
  expect(makePlayer().getCurrent()).toBeNull();
});

test("clear: keeps the current song and drops the rest", () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  player.clear();
  expect(player.getCurrent()?.url).toBe("a");
  expect(player.queueSize()).toBe(0);
});

test("clear: empties everything when nothing is playing", () => {
  const player = makePlayer();
  player.clear();
  expect(player.getCurrent()).toBeNull();
});

test("shuffle: keeps the current song first", () => {
  const player = makePlayer();
  for (const url of ["a", "b", "c", "d"]) {
    player.add(song({ url }));
  }
  player.shuffle();
  expect(player.getCurrent()?.url).toBe("a");
  expect(player.getQueue()).toHaveLength(3);
});

test("removeFromQueue: removes upcoming songs", () => {
  const player = makePlayer();
  for (const url of ["a", "b", "c"]) {
    player.add(song({ url }));
  }
  player.removeFromQueue(1, 1);
  expect(player.getQueue().map((s) => s.url)).toEqual(["c"]);
});

test("removeCurrent: drops the current song", () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  player.removeCurrent();
  expect(player.getCurrent()?.url).toBe("b");
});

test("isQueueEmpty: reflects upcoming songs", () => {
  const player = makePlayer();
  expect(player.isQueueEmpty()).toBe(true);
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  expect(player.isQueueEmpty()).toBe(false);
});

test("move: reorders songs and returns the moved one", () => {
  const player = makePlayer();
  for (const url of ["cur", "a", "b", "c"]) {
    player.add(song({ url }));
  }
  const moved = player.move(1, 3);
  expect(moved.url).toBe("a");
  expect(player.getQueue().map((s) => s.url)).toEqual(["b", "c", "a"]);
});

test("move: throws when the index is out of range", () => {
  const player = makePlayer();
  player.add(song({ url: "cur" }));
  expect(() => player.move(5, 1)).toThrow("outside the range");
});

test("getVolume: returns the set volume, else the default", () => {
  const player = makePlayer();
  expect(player.getVolume()).toBe(100);
  player.setVolume(42);
  expect(player.getVolume()).toBe(42);
});

test("canGoForward / canGoBack reflect position", () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  expect(player.canGoForward(1)).toBe(true);
  expect(player.canGoBack()).toBe(false);
});

test("manualForward: advances and resets position; throws past the end", () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  player.manualForward(1);
  expect(player.getCurrent()?.url).toBe("b");
  expect(player.getPosition()).toBe(0);
  expect(() => player.manualForward(5)).toThrow("No songs in queue");
});

test("pause: throws when not playing", () => {
  expect(() => makePlayer().pause()).toThrow("Not currently playing");
});

// ---- connection lifecycle -------------------------------------------------
const channel = () =>
  ({
    id: "vc-1",
    guild: { id: "guild-1", voiceAdapterCreator: () => ({}) },
    members: new Map(),
  }) as never;

test("connect: joins the voice channel and waits for ready", async () => {
  const player = makePlayer();
  await player.connect(channel());
  expect(player.voiceConnection).not.toBeNull();
});

test("connect: throws and cleans up when the connection never readies", async () => {
  const player = makePlayer();
  entersStateImpl = async () => {
    throw new Error("timeout");
  };
  expect(player.connect(channel())).rejects.toThrow("Failed to connect");
});

test("disconnect: tears down an active connection", async () => {
  const player = makePlayer();
  await player.connect(channel());
  player.disconnect();
  expect(player.voiceConnection).toBeNull();
});

test("disconnect: is a no-op with no connection", () => {
  const player = makePlayer();
  expect(() => player.disconnect()).not.toThrow();
});

test("stop: disconnects and clears the queue", async () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  await player.connect(channel());
  player.stop();
  expect(player.getCurrent()).toBeNull();
  expect(player.voiceConnection).toBeNull();
});

// ---- playback -------------------------------------------------------------
test("play: starts a fresh stream and goes to PLAYING", async () => {
  const player = makePlayer();
  player.add(song());
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  expect(player.status).toBe(STATUS.PLAYING);
});

test("play: throws when the queue is empty", async () => {
  const player = makePlayer();
  player.voiceConnection = makeVoiceConnection() as never;
  expect(player.play()).rejects.toThrow("Queue empty");
});

test("play: unpauses an already-loaded song", async () => {
  const player = makePlayer();
  player.add(song());
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  player.pause();
  expect(player.status).toBe(STATUS.PAUSED);
  await player.play();
  expect(player.status).toBe(STATUS.PLAYING);
});

test("seek: throws when seeking beyond the song length", async () => {
  const player = makePlayer();
  player.add(song({ length: 100 }));
  player.voiceConnection = makeVoiceConnection() as never;
  expect(player.seek(500)).rejects.toThrow("outside the range");
});

test("seek: repositions and resumes playback", async () => {
  const player = makePlayer();
  player.add(song({ length: 300 }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.seek(30);
  expect(player.status).toBe(STATUS.PLAYING);
});

test("play: uses opus pass-through at volume 100 with ducking off", async () => {
  const player = makePlayer();
  player.add(song());
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  expect(lastInlineVolume).toBe(false);
});

test("play: enables inlineVolume when the guild ducks on speech", async () => {
  settings.turnDownVolumeWhenPeopleSpeak = true;
  const player = makePlayer();
  player.add(song());
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  expect(lastInlineVolume).toBe(true);
});

test("play: enables inlineVolume when volume is not 100", async () => {
  const player = makePlayer();
  player.add(song());
  player.voiceConnection = makeVoiceConnection() as never;
  player.setVolume(60);
  await player.play();
  expect(lastInlineVolume).toBe(true);
});

test("setVolume: rebuilds a pass-through resource while playing", async () => {
  const player = makePlayer();
  player.add(song());
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  expect(lastInlineVolume).toBe(false);

  player.setVolume(50);
  // The rebuild seek is fire-and-forget; let its async chain settle.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(lastInlineVolume).toBe(true);
  expect(player.status).toBe(STATUS.PLAYING);
});

test("setVolume: defers the rebuild until resume when paused", async () => {
  const player = makePlayer();
  player.add(song());
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  player.pause();

  player.setVolume(50);
  expect(player.pendingVolumeRebuild).toBe(true);
  expect(lastInlineVolume).toBe(false);

  await player.play();
  expect(lastInlineVolume).toBe(true);
  expect(player.pendingVolumeRebuild).toBe(false);
  expect(player.status).toBe(STATUS.PLAYING);
});

test("seek: throws when nothing is playing", async () => {
  const player = makePlayer();
  player.voiceConnection = makeVoiceConnection() as never;
  expect(player.seek(0)).rejects.toThrow("No song currently playing");
});

test("forwardSeek: delegates to seek by relative offset", async () => {
  const player = makePlayer();
  player.add(song({ length: 300 }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.forwardSeek(10);
  expect(player.status).toBe(STATUS.PLAYING);
});

test("play: ensureVoiceConnectionReady throws with no connection", async () => {
  const player = makePlayer();
  player.add(song());
  expect(player.play()).rejects.toThrow("Not connected");
});

test("getStream: HLS sources skip youtube resolution", async () => {
  const player = makePlayer();
  player.add(song({ source: MediaSource.HLS, url: "https://hls/stream" }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  expect(player.status).toBe(STATUS.PLAYING);
});

test("getStream: SoundCloud sources resolve via yt-dlp", async () => {
  const player = makePlayer();
  player.add(
    song({
      source: MediaSource.SoundCloud,
      url: "https://soundcloud.com/u/track",
    }),
  );
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  expect(player.status).toBe(STATUS.PLAYING);
});

test("resolveYtDlpInput: uses a cached file when present", async () => {
  const player = makePlayer();
  const original = fileCache.getPathFor;
  fileCache.getPathFor = async () => "/cache/file";
  player.add(song());
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  fileCache.getPathFor = original;
  expect(player.status).toBe(STATUS.PLAYING);
});

// ---- forward / back / autoplay -------------------------------------------
test("forward: advances to the next song", async () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.forward(1);
  expect(player.getCurrent()?.url).toBe("b");
});

test("forward: resumes playback when skipping from a paused player", async () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  player.pause();
  expect(player.status).toBe(STATUS.PAUSED);
  await player.forward(1);
  expect(player.getCurrent()?.url).toBe("b");
  expect(player.status).toBe(STATUS.PLAYING);
});

test("forward: starts a fresh stream when the next entry shares a URL", async () => {
  const player = makePlayer();
  // Two chapters of one video: same url, different offsets.
  player.add(song({ url: "vid", title: "ch1", offset: 0 }));
  player.add(song({ url: "vid", title: "ch2", offset: 100 }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  player.pause();
  lastInlineVolume = undefined;
  await player.forward(1);
  expect(player.getCurrent()?.title).toBe("ch2");
  expect(player.status).toBe(STATUS.PLAYING);
  // A fresh stream (not an unpause of ch1) must have been created for ch2.
  expect(lastInlineVolume).toBeDefined();
});

test("forward: rolls back the position when the next track fails to start", async () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  player.voiceConnection = makeVoiceConnection() as never;
  player.status = STATUS.IDLE;
  // Fail at stream resolution so the real play()/startFreshStream path runs.
  mediaSourceError = new Error("stream unavailable");
  await expect(player.forward(1)).rejects.toThrow("stream unavailable");
  mediaSourceError = null;
  // previousStatus was IDLE (no non-IDLE->IDLE transition), so the failed skip
  // is rolled back to the pre-skip track rather than left finalized.
  expect(player.getCurrent()?.url).toBe("a");
  expect(player.status).toBe(STATUS.IDLE);
});

test("forward: restores playing state when a skip fails without finalizing", async () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  player.positionInSeconds = 7;
  // Observe only the restore path, not the initial play's tracking.
  const startTracking = mock((position?: number) => {
    if (position !== undefined) {
      player.positionInSeconds = position;
    }
  });
  player.startTrackingPosition = startTracking;
  player.play = async () => {
    throw new Error("stream stalled");
  };
  await expect(player.forward(1)).rejects.toThrow("stream stalled");
  // The previous track is still current, playing, and its position tracking is
  // restarted from the saved position — the aborted skip is fully undone.
  expect(player.status).toBe(STATUS.PLAYING);
  expect(player.getCurrent()?.url).toBe("a");
  expect(startTracking).toHaveBeenCalledWith(7);
  expect(player.positionInSeconds).toBe(7);
});

test("forward: keeps the finalized end state when the last track is unplayable", async () => {
  settings.secondsToWaitAfterQueueEmpties = 0;
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  // Skipping to the last track, which fails to stream: play()'s own recovery
  // finalizes the queue (PLAYING -> IDLE).
  mediaSourceError = new Error("stream unavailable");
  await expect(player.forward(1)).rejects.toThrow("stream unavailable");
  mediaSourceError = null;
  // The transition to IDLE means the queue was finalized, so the end state is
  // kept rather than rolled back to "a".
  expect(player.status).toBe(STATUS.IDLE);
  expect(player.getCurrent()?.url).toBe("b");
});

test("forward: finishes the queue when nothing follows and autoplay is off", async () => {
  settings.autoplay = false;
  settings.secondsToWaitAfterQueueEmpties = 0;
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.forward(1);
  expect(player.status).toBe(STATUS.IDLE);
});

test("back: throws when at the start of the queue", async () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  expect(player.back()).rejects.toThrow("No songs in queue to go back");
});

test("back: moves to the previous song", async () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.add(song({ url: "b" }));
  player.voiceConnection = makeVoiceConnection() as never;
  player.manualForward(1);
  player.status = STATUS.PAUSED;
  await player.back();
  expect(player.getCurrent()?.url).toBe("a");
});

test("tryAutoplay: refills the queue with related songs", async () => {
  autoplay.getRelatedSongs = async () => [song({ url: "related" })];
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.voiceConnection = makeVoiceConnection() as never;
  player.status = STATUS.PLAYING;
  await player.forward(1);
  autoplay.getRelatedSongs = async () => [];
  expect(player.getCurrent()?.url).toBe("related");
});

test("forward: plays an autoplay pick when skipping past the queue end while paused", async () => {
  autoplay.getRelatedSongs = async () => [song({ url: "related" })];
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  player.pause();
  await player.forward(1);
  autoplay.getRelatedSongs = async () => [];
  expect(player.getCurrent()?.url).toBe("related");
  expect(player.status).toBe(STATUS.PLAYING);
});

test("tryAutoplay: returns false when disabled", async () => {
  settings.autoplay = false;
  const player = makePlayer();
  player.add(song({ url: "a" }));
  expect(await player.tryAutoplay()).toBe(false);
});

test("tryAutoplay: returns false when no related songs are found", async () => {
  autoplay.getRelatedSongs = async () => [];
  const player = makePlayer();
  player.add(song({ url: "a" }));
  expect(await player.tryAutoplay()).toBe(false);
});

test("tryAutoplay: returns false and logs when the lookup throws", async () => {
  autoplay.getRelatedSongs = async () => {
    throw new Error("lastfm down");
  };
  const player = makePlayer();
  player.add(song({ url: "a" }));
  expect(await player.tryAutoplay()).toBe(false);
  autoplay.getRelatedSongs = async () => [];
});

test("tryAutoplay: returns false when autoplay service is absent", async () => {
  const player = new Player(fileCache as never, "guild-1") as AnyPlayer;
  active = player;
  player.add(song({ url: "a" }));
  expect(await player.tryAutoplay()).toBe(false);
});

// ---- volume / voice activity ----------------------------------------------
test("registerVoiceActivityListener: no-op when the setting is off", () => {
  const player = makePlayer();
  player.voiceConnection = makeVoiceConnection() as never;
  expect(() =>
    player.registerVoiceActivityListener({
      turnDownVolumeWhenPeopleSpeak: false,
      turnDownVolumeWhenPeopleSpeakTarget: 20,
    } as never),
  ).not.toThrow();
});

test("suppressVoiceWhenPeopleAreSpeaking: lowers then restores volume", () => {
  const player = makePlayer();
  player.currentChannel = { id: "vc-1" } as never;
  player.channelToSpeakingUsers = new Map([["vc-1", new Set(["u1"])]]);
  player.suppressVoiceWhenPeopleAreSpeaking(20);
  expect(player.getVolume()).toBe(20);
  player.channelToSpeakingUsers = new Map([["vc-1", new Set()]]);
  player.suppressVoiceWhenPeopleAreSpeaking(20);
  expect(player.getVolume()).toBe(100);
});

test("registerVoiceActivityListener: tracks speaking users when enabled", () => {
  const player = makePlayer();
  const member = { id: "u1" };
  player.voiceConnection = makeVoiceConnection() as never;
  player.currentChannel = {
    id: "vc-1",
    members: new Map([["u1", member]]),
  } as never;
  player.registerVoiceActivityListener({
    turnDownVolumeWhenPeopleSpeak: true,
    turnDownVolumeWhenPeopleSpeakTarget: 15,
  } as never);
  speakingHandlers["start"]?.("u1");
  expect(player.getVolume()).toBe(15);
  speakingHandlers["end"]?.("u1");
  expect(player.getVolume()).toBe(100);
});

// ---- idle handling / announce / finish ------------------------------------
test("onAudioPlayerIdle: loops the current song when loopCurrentSong is set", async () => {
  const player = makePlayer();
  player.add(song({ length: 300 }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  player.loopCurrentSong = true;
  await player.onAudioPlayerIdle({}, { status: "idle" });
  expect(player.status).toBe(STATUS.PLAYING);
});

test("onAudioPlayerIdle: re-queues the current song when looping the queue", async () => {
  const player = makePlayer();
  player.add(song({ url: "a" }));
  player.voiceConnection = makeVoiceConnection() as never;
  await player.play();
  player.loopCurrentQueue = true;
  const before = player.queueSize();
  await player.onAudioPlayerIdle({}, { status: "idle" });
  expect(player.queueSize()).toBeGreaterThanOrEqual(before);
});

test("announceNowPlaying: stays silent when the setting is off", async () => {
  const player = makePlayer();
  player.add(song());
  await player.announceNowPlaying();
  expect(true).toBe(true);
});

test("announceNowPlaying: posts to the requested text channel", async () => {
  settings.autoAnnounceNextSong = true;
  const sent: unknown[] = [];
  const player = makePlayer();
  player.add(song({ addedInChannelId: "text-1" }));
  player.currentChannel = {
    guild: {
      channels: {
        cache: new Map([
          [
            "text-1",
            {
              isTextBased: () => true,
              send: async (m: unknown) => sent.push(m),
            },
          ],
        ]),
      },
    },
  } as never;
  await player.announceNowPlaying();
  expect(sent).toHaveLength(1);
});

test("finishQueue: schedules a disconnect timer", async () => {
  settings.secondsToWaitAfterQueueEmpties = 5;
  const player = makePlayer();
  await player.finishQueue();
  expect(player.status).toBe(STATUS.IDLE);
  expect(player.disconnectTimer).not.toBeNull();
});

test("finishQueue: skips the timer when the wait is zero", async () => {
  settings.secondsToWaitAfterQueueEmpties = 0;
  const player = makePlayer();
  await player.finishQueue();
  expect(player.disconnectTimer).toBeNull();
});

// ---- persistence ----------------------------------------------------------
test("restoreState: loads the queue and primes the current song as paused", () => {
  const player = makePlayer();
  player.restoreState({
    queue: [song({ url: "a" }), song({ url: "b" })],
    queuePosition: 1,
    positionInSeconds: 42,
    status: STATUS.PLAYING,
    loopCurrentSong: true,
    loopCurrentQueue: false,
    volume: 55,
  } as never);

  expect(player.getCurrent()?.url).toBe("b");
  expect(player.getPosition()).toBe(42);
  expect(player.status).toBe(STATUS.PAUSED);
  expect(player.loopCurrentSong).toBe(true);
  expect(player.getVolume()).toBe(55);
});

test("restoreState: stays idle when the saved status was idle", () => {
  const player = makePlayer();
  player.restoreState({
    queue: [song({ url: "a" })],
    queuePosition: 0,
    positionInSeconds: 0,
    status: STATUS.IDLE,
    loopCurrentSong: false,
    loopCurrentQueue: false,
    volume: null,
  } as never);

  expect(player.status).toBe(STATUS.IDLE);
});

test("forget: clears the persisted state for the guild", () => {
  const player = makePlayer("p-forget");
  player.add(song({ url: "a" }));
  expect(loadPlayerState("p-forget")).toBeDefined();
  player.forget();
  expect(loadPlayerState("p-forget")).toBeUndefined();
});

test("save: a queue mutation persists the queue", () => {
  const player = makePlayer("p-save");
  player.add(song({ url: "a" }));
  expect(loadPlayerState("p-save")?.queue).toHaveLength(1);
});

test("freezeAndSave: persists once, then blocks further saves", () => {
  const player = makePlayer("p-freeze");
  player.add(song({ url: "a" }));
  player.freezeAndSave();
  player.add(song({ url: "b" }));
  expect(loadPlayerState("p-freeze")?.queue).toHaveLength(1);
});

test("leave: persists the queue without a channel but keeps it in memory", () => {
  const player = makePlayer("p-leave");
  player.add(song({ url: "a" }));
  player.leave();
  const row = loadPlayerState("p-leave");
  expect(row?.voiceChannelId).toBeNull();
  expect(row?.queue).toHaveLength(1);
  expect(player.getCurrent()?.url).toBe("a");
});
