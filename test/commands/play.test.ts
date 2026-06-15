import { expect, mock, test } from "bun:test";
import type { AutocompleteInteraction } from "discord.js";
import Play from "../../src/commands/play.js";
import type KeyValueCacheProvider from "../../src/services/key-value-cache.js";
import type ThirdParty from "../../src/services/third-party.js";
import { SpotifySuggestionsUnavailableError } from "../../src/utils/get-youtube-and-spotify-suggestions-for.js";
import { fakeInteraction } from "../helpers/discord.js";

const makePlay = (cacheWrap: unknown, addToQueue = mock(async () => {})) =>
  new Play(
    { spotify: {} } as unknown as ThirdParty,
    { wrap: cacheWrap } as unknown as KeyValueCacheProvider,
    { addToQueue } as never,
  );

test("constructor: builds the play slash command with spotify enabled", () => {
  const cmd = makePlay(async () => []);
  expect(cmd.slashCommand.name).toBe("play");
});

test("constructor: works without a third party (youtube-only description)", () => {
  const cmd = new Play(
    undefined as unknown as ThirdParty,
    { wrap: async () => [] } as unknown as KeyValueCacheProvider,
    { addToQueue: mock(async () => {}) } as never,
  );
  expect(cmd.slashCommand.name).toBe("play");
});

test("execute: forwards a trimmed query and options to the queue", async () => {
  const addToQueue = mock(async () => {});
  const cmd = makePlay(async () => [], addToQueue);
  const { interaction } = fakeInteraction({
    strings: { query: "  never gonna  " },
    booleans: { immediate: true, skip: true },
  });

  await cmd.execute(interaction);

  expect(addToQueue).toHaveBeenCalledTimes(1);
  const arg = addToQueue.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(arg.query).toBe("never gonna");
  expect(arg.addToFrontOfQueue).toBe(true);
  expect(arg.skipCurrentTrack).toBe(true);
  expect(arg.shuffleAdditions).toBe(false);
});

test("autocomplete: responds empty for a blank query", async () => {
  const cmd = makePlay(async () => []);
  const { interaction, responses } = fakeInteraction({ strings: {} });

  await cmd.handleAutocompleteInteraction(
    interaction as unknown as AutocompleteInteraction,
  );

  expect(responses[0]).toEqual([]);
});

test("autocomplete: responds empty for a URL query", async () => {
  const cmd = makePlay(async () => [{ name: "x", value: "x" }]);
  const { interaction, responses } = fakeInteraction({
    strings: { query: "https://youtube.com/watch?v=abc" },
  });

  await cmd.handleAutocompleteInteraction(
    interaction as unknown as AutocompleteInteraction,
  );

  expect(responses[0]).toEqual([]);
});

test("autocomplete: returns cached suggestions", async () => {
  const suggestions = [{ name: "YouTube: song", value: "song" }];
  const cmd = makePlay(async () => suggestions);
  const { interaction, responses } = fakeInteraction({
    strings: { query: "song" },
  });

  await cmd.handleAutocompleteInteraction(
    interaction as unknown as AutocompleteInteraction,
  );

  expect(responses[0]).toEqual(suggestions);
});

test("autocomplete: falls back to partial suggestions when spotify is down", async () => {
  const partial = [{ name: "YouTube: only", value: "only" }];
  const cmd = makePlay(async () => {
    throw new SpotifySuggestionsUnavailableError(partial, new Error("down"));
  });
  const { interaction, responses } = fakeInteraction({
    strings: { query: "song" },
  });

  await cmd.handleAutocompleteInteraction(
    interaction as unknown as AutocompleteInteraction,
  );

  expect(responses[0]).toEqual(partial);
});

test("autocomplete: rethrows unexpected errors", async () => {
  const cmd = makePlay(async () => {
    throw new Error("boom");
  });
  const { interaction } = fakeInteraction({ strings: { query: "song" } });

  expect(
    cmd.handleAutocompleteInteraction(
      interaction as unknown as AutocompleteInteraction,
    ),
  ).rejects.toThrow("boom");
});
