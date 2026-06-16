import {
  customType,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { QueuedSong } from "../services/player.js";

/**
 * DateTime column stored to match what the previous Prisma + libSQL stack
 * wrote, so existing databases keep working byte-for-byte: ISO-8601 text with
 * an explicit "+00:00" offset (e.g. "2026-06-14T12:34:56.789+00:00"). Writing
 * the identical format keeps lexical ordering consistent across old and new
 * rows, which matters because the file-cache LRU eviction orders by
 * `accessedAt` in SQL.
 *
 * Reads also tolerate the integer-seconds encoding a one-off 2022 migration
 * produced, in case any untouched bookkeeping value still carries it.
 */
const timestamp = customType<{ data: Date; driverData: string | number }>({
  dataType() {
    return "DATETIME";
  },
  toDriver(value) {
    return value.toISOString().replace("Z", "+00:00");
  },
  fromDriver(value) {
    return typeof value === "number" ? new Date(value * 1000) : new Date(value);
  },
});

const createdAt = timestamp("createdAt")
  .notNull()
  .$defaultFn(() => new Date());

const updatedAt = timestamp("updatedAt")
  .notNull()
  .$defaultFn(() => new Date())
  .$onUpdateFn(() => new Date());

export const fileCache = sqliteTable("FileCache", {
  hash: text("hash").primaryKey(),
  bytes: integer("bytes").notNull(),
  accessedAt: timestamp("accessedAt").notNull(),
  createdAt,
  updatedAt,
});

export const keyValueCache = sqliteTable("KeyValueCache", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt,
  updatedAt,
});

export const setting = sqliteTable("Setting", {
  guildId: text("guildId").primaryKey(),
  playlistLimit: integer("playlistLimit").notNull().default(50),
  secondsToWaitAfterQueueEmpties: integer("secondsToWaitAfterQueueEmpties")
    .notNull()
    .default(30),
  leaveIfNoListeners: integer("leaveIfNoListeners", { mode: "boolean" })
    .notNull()
    .default(true),
  queueAddResponseEphemeral: integer("queueAddResponseEphemeral", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  autoAnnounceNextSong: integer("autoAnnounceNextSong", { mode: "boolean" })
    .notNull()
    .default(false),
  autoplay: integer("autoplay", { mode: "boolean" }).notNull().default(true),
  defaultVolume: integer("defaultVolume").notNull().default(100),
  defaultQueuePageSize: integer("defaultQueuePageSize").notNull().default(10),
  turnDownVolumeWhenPeopleSpeak: integer("turnDownVolumeWhenPeopleSpeak", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  turnDownVolumeWhenPeopleSpeakTarget: integer(
    "turnDownVolumeWhenPeopleSpeakTarget",
  )
    .notNull()
    .default(20),
  createdAt,
  updatedAt,
});

export const favoriteQuery = sqliteTable(
  "FavoriteQuery",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guildId").notNull(),
    authorId: text("authorId").notNull(),
    name: text("name").notNull(),
    query: text("query").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("FavoriteQuery_guildId_name_key").on(table.guildId, table.name),
  ],
);

// Per-guild player snapshot so the queue and voice connection survive a bot
// restart. Written as the player mutates and on shutdown; cleared on an
// intentional stop/disconnect. `status` holds the numeric STATUS enum.
export const playerState = sqliteTable("PlayerState", {
  guildId: text("guildId").primaryKey(),
  voiceChannelId: text("voiceChannelId"),
  queue: text("queue", { mode: "json" }).$type<QueuedSong[]>().notNull(),
  queuePosition: integer("queuePosition").notNull().default(0),
  positionInSeconds: integer("positionInSeconds").notNull().default(0),
  status: integer("status").notNull(),
  loopCurrentSong: integer("loopCurrentSong", { mode: "boolean" })
    .notNull()
    .default(false),
  loopCurrentQueue: integer("loopCurrentQueue", { mode: "boolean" })
    .notNull()
    .default(false),
  volume: integer("volume"),
  createdAt,
  updatedAt,
});

// Kept so callers can name row types without importing Prisma's generated
// types (e.g. these were previously imported from the Prisma client).
export type Setting = typeof setting.$inferSelect;
export type FileCache = typeof fileCache.$inferSelect;
export type PlayerState = typeof playerState.$inferSelect;
