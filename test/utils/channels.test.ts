import { expect, test } from "bun:test";
import {
  ChannelType,
  Collection,
  type Guild,
  type GuildMember,
  type User,
  type VoiceChannel,
} from "discord.js";
import {
  getMemberVoiceChannel,
  getMostPopularVoiceChannel,
  getSizeWithoutBots,
  isUserInVoice,
} from "../../src/utils/channels.js";

const member = (id: string, bot = false) =>
  ({ id, user: { id, bot } }) as unknown as GuildMember;

const voiceChannel = (id: string, members: GuildMember[]) =>
  ({
    id,
    type: ChannelType.GuildVoice,
    members: new Collection(members.map((m) => [m.id, m])),
  }) as unknown as VoiceChannel;

const textChannel = (id: string) =>
  ({ id, type: ChannelType.GuildText }) as unknown as VoiceChannel;

const guildWith = (channels: VoiceChannel[]) =>
  ({
    channels: { cache: new Collection(channels.map((c) => [c.id, c])) },
  }) as unknown as Guild;

const asUser = (id: string) => ({ id }) as unknown as User;

test("getSizeWithoutBots: counts humans and ignores bots", () => {
  const channel = voiceChannel("v1", [
    member("a"),
    member("b"),
    member("bot", true),
  ]);
  expect(getSizeWithoutBots(channel)).toBe(2);
});

test("getSizeWithoutBots: returns 0 for an empty channel", () => {
  expect(getSizeWithoutBots(voiceChannel("v1", []))).toBe(0);
});

test("isUserInVoice: true when the user is in a voice channel", () => {
  const guild = guildWith([voiceChannel("v1", [member("u1"), member("u2")])]);
  expect(isUserInVoice(guild, asUser("u1"))).toBe(true);
});

test("isUserInVoice: false when the user is in no voice channel", () => {
  const guild = guildWith([voiceChannel("v1", [member("u2")])]);
  expect(isUserInVoice(guild, asUser("u1"))).toBe(false);
});

test("isUserInVoice: ignores non-voice channels", () => {
  const guild = guildWith([textChannel("t1")]);
  expect(isUserInVoice(guild, asUser("u1"))).toBe(false);
});

test("getMemberVoiceChannel: returns the channel and human count", () => {
  const channel = voiceChannel("v1", [member("u1"), member("bot", true)]);
  const result = getMemberVoiceChannel({
    voice: { channel },
  } as unknown as GuildMember);
  expect(result).toEqual([channel, 1]);
});

test("getMemberVoiceChannel: returns null when the member is undefined", () => {
  expect(getMemberVoiceChannel(undefined)).toBeNull();
});

test("getMemberVoiceChannel: returns null when the member is not in voice", () => {
  const result = getMemberVoiceChannel({
    voice: { channel: null },
  } as unknown as GuildMember);
  expect(result).toBeNull();
});

test("getMostPopularVoiceChannel: returns the channel with the most humans", () => {
  const quiet = voiceChannel("v1", [member("u1")]);
  const busy = voiceChannel("v2", [member("u2"), member("u3"), member("u4")]);
  const [channel, count] = getMostPopularVoiceChannel(guildWith([quiet, busy]));
  expect(channel.id).toBe("v2");
  expect(count).toBe(3);
});

test("getMostPopularVoiceChannel: throws when there are no voice channels", () => {
  expect(() => getMostPopularVoiceChannel(guildWith([]))).toThrow();
});
