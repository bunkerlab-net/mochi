import { expect, mock, test } from "bun:test";
import { ChannelType, type ChatInputCommandInteraction } from "discord.js";
import Join from "../../src/commands/join.js";
import Summon from "../../src/commands/summon.js";
import { fakeManager } from "../helpers/discord.js";

const voiceChannel = {
  id: "vc-1",
  type: ChannelType.GuildVoice,
  members: { reduce: () => 1 },
};

const makeInteraction = () => {
  const replies: string[] = [];
  const interaction = {
    guild: { id: "guild-1" },
    member: { voice: { channel: voiceChannel } },
    deferReply: async () => {},
    reply: async (message: string) => {
      replies.push(String(message));
    },
    editReply: async (message: string) => {
      replies.push(String(message));
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies };
};

test("join: connects and plays when the queue has music", async () => {
  const connect = mock(async () => {});
  const play = mock(async () => {});
  const cmd = new Join(
    fakeManager({ connect, getCurrent: () => ({ url: "a" }), play }),
  );
  const { interaction, replies } = makeInteraction();

  await cmd.execute(interaction);

  expect(connect).toHaveBeenCalled();
  expect(play).toHaveBeenCalled();
  expect(replies[0]).toContain("joined and playing");
});

test("join: connects without playing when the queue is empty", async () => {
  const connect = mock(async () => {});
  const play = mock(async () => {});
  const cmd = new Join(fakeManager({ connect, getCurrent: () => null, play }));
  const { interaction, replies } = makeInteraction();

  await cmd.execute(interaction);

  expect(connect).toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
  expect(replies[0]).toBe("hai, joined");
});

test("summon: joins and plays like join", async () => {
  const connect = mock(async () => {});
  const play = mock(async () => {});
  const cmd = new Summon(
    fakeManager({ connect, getCurrent: () => ({ url: "a" }), play }),
  );
  const { interaction } = makeInteraction();

  await cmd.execute(interaction);

  expect(connect).toHaveBeenCalled();
  expect(play).toHaveBeenCalled();
});
