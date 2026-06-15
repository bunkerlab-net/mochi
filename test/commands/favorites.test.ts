import { beforeAll, beforeEach, expect, mock, test } from "bun:test";
import type { AutocompleteInteraction } from "discord.js";
import { eq } from "drizzle-orm";
import { db, runMigrations } from "../../src/db/index.js";
import { favoriteQuery } from "../../src/db/schema.js";
import { fakeInteraction } from "../helpers/discord.js";

// Pagination.djs renders to a live Discord interaction; stub it so the
// populated "list" branch runs without a real paginator.
let renderCount = 0;
mock.module("pagination.djs", () => ({
  Pagination: class {
    setFields() {
      return this;
    }
    paginateFields() {
      return this;
    }
    async render() {
      renderCount++;
    }
  },
}));

const { default: Favorites } = await import("../../src/commands/favorites.js");

const makeCmd = (addToQueue = mock(async () => {})) =>
  new Favorites({ addToQueue } as never);

const insert = (
  name: string,
  opts: { authorId?: string; query?: string } = {},
) =>
  db
    .insert(favoriteQuery)
    .values({
      name,
      query: opts.query ?? "some query",
      authorId: opts.authorId ?? "user-1",
      guildId: "guild-1",
    })
    .run();

const autocomplete = (interaction: unknown) =>
  makeCmd().handleAutocompleteInteraction(
    interaction as AutocompleteInteraction,
  );

beforeAll(() => {
  runMigrations();
});

beforeEach(() => {
  db.delete(favoriteQuery).run();
  renderCount = 0;
});

test("create: inserts a new favorite", async () => {
  const { interaction, replies } = fakeInteraction({
    subcommand: "create",
    strings: { name: "fav1", query: "rick astley" },
  });

  await makeCmd().execute(interaction);

  expect(replies[0]).toContain("created");
  const row = db
    .select()
    .from(favoriteQuery)
    .where(eq(favoriteQuery.name, "fav1"))
    .get();
  expect(row?.query).toBe("rick astley");
});

test("create: rejects a duplicate name", async () => {
  insert("dup");
  const { interaction } = fakeInteraction({
    subcommand: "create",
    strings: { name: "dup", query: "x" },
  });

  expect(makeCmd().execute(interaction)).rejects.toThrow("already exists");
});

test("use: queues the favorite's query with options", async () => {
  insert("myfav", { query: "the query" });
  const addToQueue = mock(async () => {});
  const { interaction } = fakeInteraction({
    subcommand: "use",
    strings: { name: "myfav" },
    booleans: { shuffle: true },
  });

  await makeCmd(addToQueue).execute(interaction);

  const arg = addToQueue.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(arg.query).toBe("the query");
  expect(arg.shuffleAdditions).toBe(true);
  expect(arg.addToFrontOfQueue).toBe(false);
});

test("use: throws when the favorite is missing", async () => {
  const { interaction } = fakeInteraction({
    subcommand: "use",
    strings: { name: "nope" },
  });

  expect(makeCmd().execute(interaction)).rejects.toThrow("no favorite");
});

test("list: reports when there are no favorites", async () => {
  const { interaction, replies } = fakeInteraction({ subcommand: "list" });

  await makeCmd().execute(interaction);

  expect(replies[0]).toContain("aren't any favorites");
});

test("list: paginates existing favorites", async () => {
  insert("a");
  insert("b");
  const { interaction } = fakeInteraction({ subcommand: "list" });

  await makeCmd().execute(interaction);

  expect(renderCount).toBe(1);
});

test("remove: deletes the author's own favorite", async () => {
  insert("mine", { authorId: "user-1" });
  const { interaction, replies } = fakeInteraction({
    subcommand: "remove",
    strings: { name: "mine" },
    userId: "user-1",
  });

  await makeCmd().execute(interaction);

  expect(replies[0]).toContain("removed");
  expect(
    db.select().from(favoriteQuery).where(eq(favoriteQuery.name, "mine")).get(),
  ).toBeUndefined();
});

test("remove: lets the guild owner remove another user's favorite", async () => {
  insert("theirs", { authorId: "user-1" });
  const { interaction } = fakeInteraction({
    subcommand: "remove",
    strings: { name: "theirs" },
    userId: "owner-1",
    ownerId: "owner-1",
  });

  await makeCmd().execute(interaction);

  expect(
    db
      .select()
      .from(favoriteQuery)
      .where(eq(favoriteQuery.name, "theirs"))
      .get(),
  ).toBeUndefined();
});

test("remove: blocks removing another user's favorite", async () => {
  insert("theirs", { authorId: "user-1" });
  const { interaction } = fakeInteraction({
    subcommand: "remove",
    strings: { name: "theirs" },
    userId: "user-2",
    ownerId: "owner-1",
  });

  expect(makeCmd().execute(interaction)).rejects.toThrow(
    "only remove your own",
  );
});

test("remove: throws when the favorite is missing", async () => {
  const { interaction } = fakeInteraction({
    subcommand: "remove",
    strings: { name: "ghost" },
  });

  expect(makeCmd().execute(interaction)).rejects.toThrow("no favorite");
});

test("execute: throws on an unknown subcommand", async () => {
  const { interaction } = fakeInteraction({ subcommand: "bogus" });

  expect(makeCmd().execute(interaction)).rejects.toThrow("unknown subcommand");
});

test("autocomplete: returns all favorites for an empty query", async () => {
  insert("alpha");
  insert("beta");
  const { interaction, responses } = fakeInteraction({
    subcommand: "use",
    strings: { name: "" },
  });

  await autocomplete(interaction);

  expect((responses[0] as unknown[]).length).toBe(2);
});

test("autocomplete: filters by name prefix", async () => {
  insert("alpha");
  insert("beta");
  const { interaction, responses } = fakeInteraction({
    subcommand: "use",
    strings: { name: "al" },
  });

  await autocomplete(interaction);

  expect(responses[0]).toEqual([{ name: "alpha", value: "alpha" }]);
});

test("autocomplete (remove): a non-owner sees only their own", async () => {
  insert("mine", { authorId: "user-2" });
  insert("theirs", { authorId: "user-1" });
  const { interaction, responses } = fakeInteraction({
    subcommand: "remove",
    strings: { name: "" },
    userId: "user-2",
    ownerId: "owner-1",
  });

  await autocomplete(interaction);

  expect(responses[0]).toEqual([{ name: "mine", value: "mine" }]);
});

test("autocomplete (remove): the guild owner sees all", async () => {
  insert("mine", { authorId: "user-2" });
  insert("theirs", { authorId: "user-1" });
  const { interaction, responses } = fakeInteraction({
    subcommand: "remove",
    strings: { name: "" },
    userId: "owner-1",
    ownerId: "owner-1",
  });

  await autocomplete(interaction);

  expect((responses[0] as unknown[]).length).toBe(2);
});

test("autocomplete: caps results at 25", async () => {
  for (let i = 0; i < 30; i++) {
    insert(`fav${i.toString().padStart(2, "0")}`);
  }
  const { interaction, responses } = fakeInteraction({
    subcommand: "use",
    strings: { name: "" },
  });

  await autocomplete(interaction);

  expect((responses[0] as unknown[]).length).toBe(25);
});
