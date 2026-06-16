import { beforeAll, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/index.js";
import { MediaSource, STATUS } from "../../src/services/player.js";
import {
  clearPlayerState,
  loadAllPlayerStates,
  loadPlayerState,
  type PlayerStateSnapshot,
  savePlayerState,
} from "../../src/utils/player-state.js";

beforeAll(() => {
  runMigrations();
});

const song = (url: string) => ({
  title: "Song",
  artist: "Artist",
  url,
  length: 200,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: MediaSource.Youtube,
  addedInChannelId: "chan-1",
  requestedBy: "user-1",
});

const snapshot = (
  guildId: string,
  overrides: Partial<PlayerStateSnapshot> = {},
): PlayerStateSnapshot => ({
  guildId,
  voiceChannelId: "vc-1",
  queue: [song("a"), song("b")],
  queuePosition: 1,
  positionInSeconds: 42,
  status: STATUS.PLAYING,
  loopCurrentSong: false,
  loopCurrentQueue: false,
  volume: null,
  ...overrides,
});

test("save then load round-trips the snapshot", () => {
  savePlayerState(snapshot("ps-1"));
  const row = loadPlayerState("ps-1");
  expect(row?.voiceChannelId).toBe("vc-1");
  expect(row?.queue).toHaveLength(2);
  expect(row?.queue[1]?.url).toBe("b");
  expect(row?.queuePosition).toBe(1);
  expect(row?.positionInSeconds).toBe(42);
  expect(row?.status).toBe(STATUS.PLAYING);
});

test("save upserts the row on conflict", () => {
  savePlayerState(snapshot("ps-2", { positionInSeconds: 10 }));
  savePlayerState(snapshot("ps-2", { positionInSeconds: 99 }));
  expect(loadPlayerState("ps-2")?.positionInSeconds).toBe(99);
  expect(
    loadAllPlayerStates().filter((s) => s.guildId === "ps-2"),
  ).toHaveLength(1);
});

test("clear removes the snapshot", () => {
  savePlayerState(snapshot("ps-3"));
  clearPlayerState("ps-3");
  expect(loadPlayerState("ps-3")).toBeUndefined();
});
