import { beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, runMigrations } from "../../src/db/index.js";
import { keyValueCache } from "../../src/db/schema.js";
import KeyValueCacheProvider from "../../src/services/key-value-cache.js";

beforeAll(() => {
  runMigrations();
});

const cache = new KeyValueCacheProvider();

test("computes and caches a result on a miss, then returns it on a hit", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    return { value: 42 };
  };

  const first = await cache.wrap(fn, { expiresIn: 60, key: "kv-test-hit" });
  const second = await cache.wrap(fn, { expiresIn: 60, key: "kv-test-hit" });

  expect(first).toEqual({ value: 42 });
  expect(second).toEqual({ value: 42 });
  // Second call is served from cache, so the function only ran once.
  expect(calls).toBe(1);

  db.delete(keyValueCache).where(eq(keyValueCache.key, "kv-test-hit")).run();
});

test("recomputes when the cached entry has expired", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    return calls;
  };

  // Negative expiry: the entry is already expired the moment it is written.
  await cache.wrap(fn, { expiresIn: -60, key: "kv-test-expired" });
  const second = await cache.wrap(fn, {
    expiresIn: -60,
    key: "kv-test-expired",
  });

  expect(calls).toBe(2);
  expect(second).toBe(2);

  db.delete(keyValueCache)
    .where(eq(keyValueCache.key, "kv-test-expired"))
    .run();
});

test("derives the cache key from the function args when none is given", async () => {
  const fn = async (_a: number, _b: string, _opts: { expiresIn: number }) =>
    "derived";

  const result = await cache.wrap(fn, 1, "two", { expiresIn: 60 });
  expect(result).toBe("derived");

  // Key is JSON.stringify([1, "two"]).
  const row = db
    .select()
    .from(keyValueCache)
    .where(eq(keyValueCache.key, JSON.stringify([1, "two"])))
    .get();
  expect(row).toBeTruthy();

  db.delete(keyValueCache)
    .where(eq(keyValueCache.key, JSON.stringify([1, "two"])))
    .run();
});

test("throws when no options are supplied", async () => {
  const fn = async () => "x";
  expect(cache.wrap(fn)).rejects.toThrow("Missing cache options");
});

test("throws when the cache key is too short", async () => {
  const fn = async () => "x";
  expect(cache.wrap(fn, { expiresIn: 60, key: "ab" })).rejects.toThrow(
    "too short",
  );
});
