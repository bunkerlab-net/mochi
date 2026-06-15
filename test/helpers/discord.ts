import type { ChatInputCommandInteraction } from "discord.js";
import type PlayerManager from "../../src/managers/player.js";

// Minimal interaction stand-in for command tests. Captures replies and
// autocomplete responses so tests can assert on user-facing output, and serves
// option values from plain maps. PlayerManager is imported as a type only, so
// this helper does not pull the (heavy) player module into the test graph.
export interface FakeInteractionOptions {
  guildId?: string;
  userId?: string;
  ownerId?: string;
  subcommand?: string;
  strings?: Record<string, string | null>;
  integers?: Record<string, number | null>;
  booleans?: Record<string, boolean | null>;
}

export const fakeInteraction = (opts: FakeInteractionOptions = {}) => {
  const replies: string[] = [];
  const responses: unknown[] = [];
  const interaction = {
    guild: {
      id: opts.guildId ?? "guild-1",
      ownerId: opts.ownerId ?? "owner-1",
    },
    member: { user: { id: opts.userId ?? "user-1" } },
    reply: async (message: string) => {
      replies.push(String(message));
    },
    deferReply: async () => {},
    editReply: async (message: string) => {
      replies.push(String(message));
    },
    respond: async (choices: unknown) => {
      responses.push(choices);
    },
    options: {
      getSubcommand: () => opts.subcommand ?? "",
      getString: (name: string) => opts.strings?.[name] ?? null,
      getInteger: (name: string) => opts.integers?.[name] ?? null,
      getBoolean: (name: string) => opts.booleans?.[name] ?? null,
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies, responses };
};

export const fakeManager = (player: unknown) =>
  ({ get: () => player }) as unknown as PlayerManager;
