import { expect, mock, test } from "bun:test";
import type { AutocompleteInteraction } from "discord.js";
import PlayNow from "../../src/commands/playnow.js";
import type KeyValueCacheProvider from "../../src/services/key-value-cache.js";
import type ThirdParty from "../../src/services/third-party.js";
import { fakeInteraction } from "../helpers/discord.js";

const makePlayNow = (
  addToQueue = mock(async () => {}),
  cacheWrap: unknown = async () => [],
) =>
  new PlayNow(
    { spotify: {} } as unknown as ThirdParty,
    { wrap: cacheWrap } as unknown as KeyValueCacheProvider,
    { addToQueue } as never,
  );

test("constructor: registers the playnow slash command", () => {
  expect(makePlayNow().slashCommand.name).toBe("playnow");
});

test("constructor: exposes the query and per-request toggles", () => {
  const names = makePlayNow()
    .slashCommand.toJSON()
    .options?.map((option) => option.name);
  expect(names).toEqual(["query", "shuffle", "split", "mix", "autoplay"]);
});

test("constructor: query description omits Spotify without a third party", () => {
  const cmd = new PlayNow(
    undefined as unknown as ThirdParty,
    { wrap: async () => [] } as unknown as KeyValueCacheProvider,
    { addToQueue: mock(async () => {}) } as never,
  );
  const query = cmd.slashCommand
    .toJSON()
    .options?.find((option) => option.name === "query");
  expect(query?.description).toBe("YouTube URL or search query");
});

test("constructor: query description mentions Spotify with a third party", () => {
  const query = makePlayNow()
    .slashCommand.toJSON()
    .options?.find((option) => option.name === "query");
  expect(query?.description).toContain("Spotify");
});

test("execute: forces front-of-queue and skip, forwarding shuffle/split", async () => {
  const addToQueue = mock(async () => {});
  const cmd = makePlayNow(addToQueue);
  const { interaction } = fakeInteraction({
    strings: { query: "  never gonna  " },
    booleans: { shuffle: true, split: true, mix: true, autoplay: false },
  });

  await cmd.execute(interaction);

  expect(addToQueue).toHaveBeenCalledTimes(1);
  const arg = addToQueue.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(arg.query).toBe("never gonna");
  expect(arg.addToFrontOfQueue).toBe(true);
  expect(arg.skipCurrentTrack).toBe(true);
  expect(arg.shuffleAdditions).toBe(true);
  expect(arg.shouldSplitChapters).toBe(true);
  expect(arg.queueMix).toBe(true);
  expect(arg.sessionAutoplay).toBe(false);
});

test("autocomplete: inherited from play, returns suggestions", async () => {
  const suggestions = [{ name: "YouTube: song", value: "song" }];
  const cmd = makePlayNow(
    mock(async () => {}),
    async () => suggestions,
  );
  const { interaction, responses } = fakeInteraction({
    strings: { query: "song" },
  });

  await cmd.handleAutocompleteInteraction(
    interaction as unknown as AutocompleteInteraction,
  );

  expect(responses[0]).toEqual(suggestions);
});
