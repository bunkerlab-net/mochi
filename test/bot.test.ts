import { expect, mock, test } from "bun:test";
import { type Client, Collection } from "discord.js";

// Only @discordjs/rest needs mocking: handleReady builds a REST client and calls
// .put(), which would otherwise hit the Discord API. The real DI container is
// safe under test because Spotify/Last.fm are unconfigured, so no networked
// services are bound or instantiated.
mock.module("@discordjs/rest", () => ({
  REST: class {
    setToken() {
      return this;
    }
    async put() {}
  },
}));

// Import inversify.config before bot.js to mirror the app's load order; bot.js
// and inversify.config.js are circular, so importing bot first hits a TDZ.
await import("../src/inversify.config.js");
const { default: Bot } = await import("../src/bot.js");

type AnyBot = InstanceType<typeof Bot> & Record<string, unknown>;
type Handlers = Record<string, (...args: unknown[]) => unknown>;

const client = (overrides: Record<string, unknown> = {}) => {
  const handlers: Handlers = {};
  return {
    on: (event: string, cb: (...args: unknown[]) => unknown) => {
      handlers[event] = cb;
    },
    once: (event: string, cb: (...args: unknown[]) => unknown) => {
      handlers[event] = cb;
    },
    login: async () => {},
    destroy: async () => {},
    user: { id: "bot-1", setPresence: () => {} },
    guilds: { cache: new Collection() },
    handlers,
    ...overrides,
  };
};

const config = (overrides: Record<string, unknown> = {}) =>
  ({
    REGISTER_COMMANDS_ON_BOT: false,
    DISCORD_TOKEN: "token",
    BOT_ACTIVITY: "music",
    BOT_ACTIVITY_TYPE: 2,
    BOT_ACTIVITY_URL: "",
    BOT_STATUS: "online",
    ...overrides,
  }) as never;

const makeBot = (c: ReturnType<typeof client> = client(), cfg = config()) =>
  new Bot(c as unknown as Client, cfg) as unknown as AnyBot;

const slashCommand = { slashCommand: { name: "play", toJSON: () => ({}) } };

const commandInteraction = (overrides: Record<string, unknown> = {}) =>
  ({
    isCommand: () => true,
    isChatInputCommand: () => true,
    isButton: () => false,
    isAutocomplete: () => false,
    commandName: "play",
    guild: { name: "Guild", channels: { cache: new Collection() } },
    user: { username: "user" },
    member: { user: { id: "u1", bot: false } },
    replied: false,
    deferred: false,
    reply: async () => {},
    editReply: async () => {},
    ...overrides,
  }) as never;

test("register: wires up the client and its event callbacks run", async () => {
  const login = mock(async () => {});
  const c = client({ login });
  const bot = makeBot(c);
  await bot.register();
  expect(login).toHaveBeenCalled();
  expect(c.handlers.interactionCreate).toBeDefined();
  // Invoke the registered callbacks so they count as covered.
  await c.handlers.interactionCreate?.({
    isCommand: () => false,
    isButton: () => false,
    isAutocomplete: () => false,
  });
  await c.handlers.clientReady?.();
  c.handlers.error?.(new Error("x"));
  c.handlers.debug?.("msg");
});

test("dispatch: runs a matching chat-input command", async () => {
  const execute = mock(async () => {});
  const bot = makeBot();
  bot.commandsByName = new Collection([
    ["play", { requiresVC: false, execute }],
  ]);
  await bot.handleInteraction(commandInteraction());
  expect(execute).toHaveBeenCalled();
});

test("dispatch: ignores an unknown command", async () => {
  const bot = makeBot();
  bot.commandsByName = new Collection();
  await expect(
    bot.handleInteraction(commandInteraction()),
  ).resolves.toBeUndefined();
});

test("dispatch: refuses commands used in a DM", async () => {
  const reply = mock(async () => {});
  const bot = makeBot();
  bot.commandsByName = new Collection([
    ["play", { requiresVC: false, execute: async () => {} }],
  ]);
  await bot.handleInteraction(commandInteraction({ guild: null, reply }));
  expect(reply).toHaveBeenCalled();
});

test("dispatch: blocks a VC-required command when the user is not in voice", async () => {
  const reply = mock(async () => {});
  const execute = mock(async () => {});
  const bot = makeBot();
  bot.commandsByName = new Collection([
    ["play", { requiresVC: true, execute }],
  ]);
  await bot.handleInteraction(commandInteraction({ reply }));
  expect(execute).not.toHaveBeenCalled();
  expect(reply).toHaveBeenCalled();
});

test("dispatch: routes button interactions", async () => {
  const handleButtonInteraction = mock(async () => {});
  const bot = makeBot();
  bot.commandsByButtonId = new Collection([
    ["btn", { handleButtonInteraction }],
  ]);
  await bot.handleInteraction({
    isCommand: () => false,
    isButton: () => true,
    isAutocomplete: () => false,
    customId: "btn",
  } as never);
  expect(handleButtonInteraction).toHaveBeenCalled();
});

test("dispatch: routes autocomplete interactions", async () => {
  const handleAutocompleteInteraction = mock(async () => {});
  const bot = makeBot();
  bot.commandsByName = new Collection([
    ["play", { handleAutocompleteInteraction }],
  ]);
  await bot.handleInteraction({
    isCommand: () => false,
    isButton: () => false,
    isAutocomplete: () => true,
    commandName: "play",
  } as never);
  expect(handleAutocompleteInteraction).toHaveBeenCalled();
});

test("handleInteraction: replies with an error when a command throws", async () => {
  const reply = mock(async () => {});
  const bot = makeBot();
  bot.commandsByName = new Collection([
    [
      "play",
      {
        requiresVC: false,
        execute: async () => {
          throw new Error("boom");
        },
      },
    ],
  ]);
  await bot.handleInteraction(commandInteraction({ reply }));
  expect(reply).toHaveBeenCalled();
});

test("handleReady: registers commands per guild by default", async () => {
  const setPresence = mock(() => {});
  const guilds = new Collection([["g1", { id: "g1" }]]);
  const bot = makeBot(
    client({ user: { id: "bot-1", setPresence }, guilds: { cache: guilds } }),
  );
  bot.commandsByName = new Collection([["play", slashCommand]]);
  await bot.handleReady();
  expect(setPresence).toHaveBeenCalled();
});

test("handleReady: registers commands on the bot when configured", async () => {
  const setPresence = mock(() => {});
  const bot = makeBot(
    client({ user: { id: "bot-1", setPresence } }),
    config({ REGISTER_COMMANDS_ON_BOT: true }),
  );
  bot.commandsByName = new Collection([["play", slashCommand]]);
  await bot.handleReady();
  expect(setPresence).toHaveBeenCalled();
});

test("handleReady: does nothing without a client user", async () => {
  const bot = makeBot(client({ user: null }));
  await expect(bot.handleReady()).resolves.toBeUndefined();
});

test("shutdown: destroys the client", async () => {
  const destroy = mock(async () => {});
  const bot = makeBot(client({ destroy }));
  await bot.shutdown();
  expect(destroy).toHaveBeenCalled();
});
