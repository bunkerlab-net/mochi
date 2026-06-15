import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
  promises as fs,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, runMigrations } from "../../src/db/index.js";
import { fileCache } from "../../src/db/schema.js";
import type Config from "../../src/services/config.js";
import FileCacheProvider from "../../src/services/file-cache.js";

let cacheDir: string;

const makeProvider = (limitBytes: number) =>
  new FileCacheProvider({
    CACHE_DIR: cacheDir,
    CACHE_LIMIT_IN_BYTES: limitBytes,
  } as unknown as Config);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForRow = async (hash: string) => {
  for (let i = 0; i < 200; i++) {
    const row = db
      .select()
      .from(fileCache)
      .where(eq(fileCache.hash, hash))
      .get();
    if (row) {
      return row;
    }
    await delay(10);
  }
  throw new Error(`timed out waiting for row ${hash}`);
};

const writeThroughStream = async (
  provider: FileCacheProvider,
  hash: string,
  contents: string,
) => {
  const stream = provider.createWriteStream(hash);
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.end(contents, () => resolve());
  });
};

beforeAll(() => {
  runMigrations();
  cacheDir = mkdtempSync(path.join(tmpdir(), "mochi-fc-"));
  mkdirSync(path.join(cacheDir, "tmp"), { recursive: true });
});

afterAll(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

beforeEach(async () => {
  db.delete(fileCache).run();
  for (const entry of await fs.readdir(cacheDir)) {
    if (entry !== "tmp") {
      await fs.rm(path.join(cacheDir, entry), { force: true });
    }
  }
  for (const entry of await fs.readdir(path.join(cacheDir, "tmp"))) {
    await fs.rm(path.join(cacheDir, "tmp", entry), { force: true });
  }
});

test("getPathFor: returns null for an unknown hash", async () => {
  const provider = makeProvider(1_000_000);
  expect(await provider.getPathFor("missing")).toBeNull();
});

test("createWriteStream persists a non-empty file and records it", async () => {
  const provider = makeProvider(1_000_000);
  await writeThroughStream(provider, "hash-write", "hello");

  const row = await waitForRow("hash-write");
  expect(row.bytes).toBe(5);

  const resolved = await provider.getPathFor("hash-write");
  expect(resolved).toBe(path.join(cacheDir, "hash-write"));
  expect(await fs.readFile(resolved as string, "utf8")).toBe("hello");
});

test("createWriteStream does not record a zero-byte file", async () => {
  const provider = makeProvider(1_000_000);
  await writeThroughStream(provider, "hash-empty", "");
  // Give the async close handler time to run and decide to skip the move.
  await delay(50);

  const row = db
    .select()
    .from(fileCache)
    .where(eq(fileCache.hash, "hash-empty"))
    .get();
  expect(row).toBeUndefined();
  expect(await provider.getPathFor("hash-empty")).toBeNull();
});

test("getPathFor: drops a row whose file vanished from disk", async () => {
  const provider = makeProvider(1_000_000);
  db.insert(fileCache)
    .values({ hash: "orphan-row", bytes: 10, accessedAt: new Date() })
    .run();

  expect(await provider.getPathFor("orphan-row")).toBeNull();
  const row = db
    .select()
    .from(fileCache)
    .where(eq(fileCache.hash, "orphan-row"))
    .get();
  expect(row).toBeUndefined();
});

test("getPathFor: bumps accessedAt on a cache hit", async () => {
  const provider = makeProvider(1_000_000);
  writeFileSync(path.join(cacheDir, "touch-me"), "data");
  const old = new Date(1000);
  db.insert(fileCache)
    .values({ hash: "touch-me", bytes: 4, accessedAt: old })
    .run();

  await provider.getPathFor("touch-me");

  const row = await waitForRow("touch-me");
  expect(row.accessedAt.getTime()).toBeGreaterThan(old.getTime());
});

test("cleanup removes a file on disk that has no database row", async () => {
  const provider = makeProvider(1_000_000);
  writeFileSync(path.join(cacheDir, "disk-orphan"), "x");

  await provider.cleanup();

  await expect(fs.access(path.join(cacheDir, "disk-orphan"))).rejects.toThrow();
});

test("cleanup removes a database row that has no file on disk", async () => {
  const provider = makeProvider(1_000_000);
  db.insert(fileCache)
    .values({ hash: "db-orphan", bytes: 10, accessedAt: new Date() })
    .run();

  await provider.cleanup();

  const row = db
    .select()
    .from(fileCache)
    .where(eq(fileCache.hash, "db-orphan"))
    .get();
  expect(row).toBeUndefined();
});

test("cleanup evicts the oldest files until under the cache limit", async () => {
  const provider = makeProvider(10);
  writeFileSync(path.join(cacheDir, "old"), "12345678");
  writeFileSync(path.join(cacheDir, "new"), "12345678");
  db.insert(fileCache)
    .values({ hash: "old", bytes: 8, accessedAt: new Date(1000) })
    .run();
  db.insert(fileCache)
    .values({ hash: "new", bytes: 8, accessedAt: new Date(2_000_000_000_000) })
    .run();

  await provider.cleanup();

  const oldRow = db
    .select()
    .from(fileCache)
    .where(eq(fileCache.hash, "old"))
    .get();
  const newRow = db
    .select()
    .from(fileCache)
    .where(eq(fileCache.hash, "new"))
    .get();
  expect(oldRow).toBeUndefined();
  expect(newRow).toBeTruthy();
});

test("cleanup is a no-op when the cache is within the limit", async () => {
  const provider = makeProvider(1_000_000);
  writeFileSync(path.join(cacheDir, "keep"), "12345678");
  db.insert(fileCache)
    .values({ hash: "keep", bytes: 8, accessedAt: new Date() })
    .run();

  await provider.cleanup();

  const row = db
    .select()
    .from(fileCache)
    .where(eq(fileCache.hash, "keep"))
    .get();
  expect(row).toBeTruthy();
});
