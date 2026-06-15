import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { DATA_DIR } from "../services/config.js";
import * as schema from "./schema.js";

// Honour a `file:`-style DATABASE_URL for local overrides, otherwise the
// SQLite file lives in the data directory. (Remote libSQL/Turso URLs are not
// supported; this is a self-hosted, on-disk database.)
export const resolveDatabasePath = (): string => {
  const url = process.env["DATABASE_URL"];
  if (url?.startsWith("file:")) {
    return url.slice("file:".length);
  }

  return path.join(DATA_DIR, "db.sqlite");
};

// The migration files ship beside the app. Resolve them relative to the working
// directory (the repo root in dev, /usr/app in the image) with an env override.
const resolveMigrationsDir = (): string =>
  process.env["DRIZZLE_DIR"] ?? path.join(process.cwd(), "drizzle");

const databasePath = resolveDatabasePath();
mkdirSync(path.dirname(databasePath), { recursive: true });

export const sqlite = new Database(databasePath);
// WAL improves concurrent read/write behaviour for the on-disk database.
sqlite.run("PRAGMA journal_mode = WAL;");

export const db = drizzle(sqlite, { schema });

const tableExists = (name: string): boolean =>
  sqlite
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) !== null;

/**
 * Adopt a database whose tables already exist from the previous Prisma stack by
 * recording the Drizzle baseline as applied, so the migrator skips its
 * `CREATE TABLE`s (which would fail) but still applies any later migration.
 *
 * Drizzle decides what to run by comparing each migration's folder timestamp
 * against the newest recorded one (see its sqlite-core migrator), so seeding the
 * baseline's own timestamp is enough — and reusing `readMigrationFiles` keeps
 * the hash and timestamp in lockstep with whatever the migrator would compute.
 */
const adoptExistingDatabase = (migrationsFolder: string): void => {
  const [baseline] = readMigrationFiles({ migrationsFolder });
  if (!baseline) {
    return;
  }

  // Same table shape the migrator creates; harmless if it (or we) already did.
  sqlite.run(
    "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
  );

  const alreadyTracked =
    sqlite.query("SELECT 1 FROM __drizzle_migrations LIMIT 1").get() !== null;
  if (alreadyTracked) {
    return;
  }

  sqlite.run(
    'INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)',
    [baseline.hash, baseline.folderMillis],
  );
};

/**
 * Apply pending migrations in-process. Idempotent — Drizzle records applied
 * migrations, so this is a no-op once the schema is current.
 */
export const runMigrations = (): void => {
  // A database from a pre-Prisma (Sequelize) install keeps the original plural
  // table names and never ran the Prisma migrations that renamed them. The
  // baseline can't adopt that shape, so fail loud instead of silently creating
  // empty tables alongside the old data.
  const legacy = sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('FileCaches', 'KeyValueCaches', 'Settings')",
    )
    .get() as { name: string } | null;
  if (legacy && !tableExists("FileCache")) {
    throw new Error(
      `Found a legacy "${legacy.name}" table from a pre-Prisma database. Upgrade with a Prisma-based release (mochi 3.0.1 or earlier) first, then return to this version.`,
    );
  }

  const migrationsFolder = resolveMigrationsDir();

  // An existing (Prisma-created) database already has the baseline schema.
  if (tableExists("FileCache")) {
    adoptExistingDatabase(migrationsFolder);
  }

  migrate(db, { migrationsFolder });
};
