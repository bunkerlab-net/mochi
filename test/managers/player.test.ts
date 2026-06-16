import { expect, mock, test } from "bun:test";
import type Autoplay from "../../src/services/autoplay.js";
import type FileCacheProvider from "../../src/services/file-cache.js";

// managers/player constructs Player, which imports get-guild-settings → DI.
mock.module("../../src/utils/get-guild-settings.js", () => ({
  getGuildSettings: async () => ({}),
}));

const { default: PlayerManager } = await import("../../src/managers/player.js");

const make = () =>
  new PlayerManager(
    {} as unknown as FileCacheProvider,
    {} as unknown as Autoplay,
  );

test("get: creates a player and caches it per guild", () => {
  const manager = make();
  const a = manager.get("guild-1");
  const again = manager.get("guild-1");
  expect(again).toBe(a);
});

test("get: returns distinct players for different guilds", () => {
  const manager = make();
  expect(manager.get("guild-1")).not.toBe(manager.get("guild-2"));
});

test("disconnectAll: runs without error across all players", () => {
  const manager = make();
  manager.get("guild-1");
  manager.get("guild-2");
  expect(() => manager.disconnectAll()).not.toThrow();
});

test("saveAndFreezeAll: runs without error across all players", () => {
  const manager = make();
  manager.get("guild-1");
  manager.get("guild-2");
  expect(() => manager.saveAndFreezeAll()).not.toThrow();
});
