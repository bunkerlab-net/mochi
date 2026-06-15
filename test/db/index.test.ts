import { afterEach, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  db,
  resolveDatabasePath,
  runMigrations,
  sqlite,
} from "../../src/db/index.js";
import { setting } from "../../src/db/schema.js";

const savedDatabaseUrl = process.env["DATABASE_URL"];

afterEach(() => {
  if (savedDatabaseUrl === undefined) {
    delete process.env["DATABASE_URL"];
  } else {
    process.env["DATABASE_URL"] = savedDatabaseUrl;
  }
});

beforeAll(() => {
  // Idempotent: brings the in-memory database up to the current schema.
  runMigrations();
});

test("resolveDatabasePath: strips the file: prefix from DATABASE_URL", () => {
  process.env["DATABASE_URL"] = "file:/tmp/custom.sqlite";
  expect(resolveDatabasePath()).toBe("/tmp/custom.sqlite");
});

test("resolveDatabasePath: falls back to a file in the data dir", () => {
  delete process.env["DATABASE_URL"];
  expect(resolveDatabasePath().endsWith("db.sqlite")).toBe(true);
});

test("runMigrations creates the expected tables", () => {
  const tables = sqlite
    .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const names = tables.map((t) => t.name);
  expect(names).toContain("Setting");
  expect(names).toContain("FileCache");
  expect(names).toContain("KeyValueCache");
});

test("runMigrations is idempotent when run twice", () => {
  expect(() => {
    runMigrations();
  }).not.toThrow();
});

test("a Setting row round-trips with schema defaults applied", () => {
  db.insert(setting).values({ guildId: "guild-db-test" }).run();

  const row = db
    .select()
    .from(setting)
    .where(eq(setting.guildId, "guild-db-test"))
    .get();

  expect(row?.guildId).toBe("guild-db-test");
  expect(row?.playlistLimit).toBe(50);
  expect(row?.autoplay).toBe(true);
  expect(row?.defaultVolume).toBe(100);
  expect(row?.createdAt).toBeInstanceOf(Date);

  db.delete(setting).where(eq(setting.guildId, "guild-db-test")).run();
});
