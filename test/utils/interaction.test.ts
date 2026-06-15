import { expect, test } from "bun:test";
import type { BaseInteraction } from "discord.js";
import {
  getGuild,
  getGuildId,
  getMemberUserId,
} from "../../src/utils/interaction.js";

const withGuild = {
  guild: { id: "guild-123" },
  member: { user: { id: "user-456" } },
} as unknown as BaseInteraction;

const withoutGuild = {} as unknown as BaseInteraction;

test("getGuild: returns the guild when present", () => {
  expect(getGuild(withGuild).id).toBe("guild-123");
});

test("getGuild: throws when there is no guild", () => {
  expect(() => getGuild(withoutGuild)).toThrow(
    "This command can only be used in a server.",
  );
});

test("getGuildId: returns the guild id", () => {
  expect(getGuildId(withGuild)).toBe("guild-123");
});

test("getGuildId: throws when there is no guild", () => {
  expect(() => getGuildId(withoutGuild)).toThrow();
});

test("getMemberUserId: returns the member's user id", () => {
  expect(getMemberUserId(withGuild)).toBe("user-456");
});

test("getMemberUserId: throws when there is no member", () => {
  expect(() => getMemberUserId(withoutGuild)).toThrow(
    "This command can only be used in a server.",
  );
});
