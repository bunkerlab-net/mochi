import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { asc, eq, gt, sum } from "drizzle-orm";
import { inject, injectable } from "inversify";
import PQueue from "p-queue";
import { db } from "../db/index.js";
import { type FileCache, fileCache } from "../db/schema.js";
import { TYPES } from "../types.js";
import logger from "../utils/logger.js";
import type Config from "./config.js";

@injectable()
export default class FileCacheProvider {
  private static readonly evictionQueue = new PQueue({ concurrency: 1 });
  private readonly config: Config;

  constructor(@inject(TYPES.Config) config: Config) {
    this.config = config;
  }

  /**
   * Returns path to cached file if it exists, otherwise returns null.
   * Updates the `accessedAt` property of the cached file.
   * @param hash lookup key
   */
  async getPathFor(hash: string): Promise<string | null> {
    const model = db
      .select()
      .from(fileCache)
      .where(eq(fileCache.hash, hash))
      .get();

    if (!model) {
      return null;
    }

    const resolvedPath = path.join(this.config.CACHE_DIR, hash);

    try {
      await fs.access(resolvedPath);
    } catch (_: unknown) {
      db.delete(fileCache).where(eq(fileCache.hash, hash)).run();

      return null;
    }

    db.update(fileCache)
      .set({ accessedAt: new Date() })
      .where(eq(fileCache.hash, hash))
      .run();

    return resolvedPath;
  }

  /**
   * Returns a write stream for the given hash key.
   * The stream handles saving a new file and will
   * update the database after the stream is closed.
   * @param hash lookup key
   */
  createWriteStream(hash: string) {
    const tmpPath = path.join(this.config.CACHE_DIR, "tmp", hash);
    const finalPath = path.join(this.config.CACHE_DIR, hash);

    const stream = createWriteStream(tmpPath);

    stream.on("close", async () => {
      // Only move if size is non-zero (may have errored out)
      const stats = await fs.stat(tmpPath);

      if (stats.size !== 0) {
        await fs.rename(tmpPath, finalPath);

        db.insert(fileCache)
          .values({
            hash,
            accessedAt: new Date(),
            bytes: stats.size,
          })
          .run();
      }

      await this.evictOldestIfNecessary();
    });

    return stream;
  }

  /**
   * Deletes orphaned cache files and evicts files if
   * necessary. Should be run on program startup so files
   * will be evicted if the cache limit has changed.
   */
  async cleanup() {
    await this.removeOrphans();
    await this.evictOldestIfNecessary();
  }

  private async evictOldestIfNecessary() {
    void FileCacheProvider.evictionQueue.add(this.evictOldest.bind(this));

    return FileCacheProvider.evictionQueue.onEmpty();
  }

  private async evictOldest() {
    logger.debug("file-cache", "Evicting oldest files...");

    let totalSizeBytes = await this.getDiskUsageInBytes();
    let numOfEvictedFiles = 0;
    // Continue to evict until we're under the limit
    while (totalSizeBytes > this.config.CACHE_LIMIT_IN_BYTES) {
      const oldest = db
        .select()
        .from(fileCache)
        .orderBy(asc(fileCache.accessedAt))
        .limit(1)
        .get();

      if (oldest) {
        db.delete(fileCache).where(eq(fileCache.hash, oldest.hash)).run();
        await fs.unlink(path.join(this.config.CACHE_DIR, oldest.hash));
        logger.debug("file-cache", `${oldest.hash} has been evicted`);
        numOfEvictedFiles++;
      }

      totalSizeBytes = await this.getDiskUsageInBytes();
    }

    if (numOfEvictedFiles > 0) {
      logger.debug(
        "file-cache",
        `${numOfEvictedFiles} files have been evicted`,
      );
    } else {
      logger.debug(
        "file-cache",
        `No files needed to be evicted. Total size of the cache is currently ${totalSizeBytes} bytes, and the cache limit is ${this.config.CACHE_LIMIT_IN_BYTES} bytes.`,
      );
    }
  }

  private async removeOrphans() {
    // Check filesystem direction (do files exist on the disk but not in the database?)
    for await (const dirent of await fs.opendir(this.config.CACHE_DIR)) {
      if (dirent.isFile()) {
        const model = db
          .select()
          .from(fileCache)
          .where(eq(fileCache.hash, dirent.name))
          .get();

        if (!model) {
          logger.debug(
            "file-cache",
            `${dirent.name} was present on disk but was not in the database. Removing from disk.`,
          );
          await fs.unlink(path.join(this.config.CACHE_DIR, dirent.name));
        }
      }
    }

    // Check database direction (do entries exist in the database but not on the disk?)
    for await (const model of this.getFindAllIterable()) {
      const filePath = path.join(this.config.CACHE_DIR, model.hash);

      try {
        await fs.access(filePath);
      } catch {
        logger.debug(
          "file-cache",
          `${model.hash} was present in database but was not on disk. Removing from database.`,
        );
        db.delete(fileCache).where(eq(fileCache.hash, model.hash)).run();
      }
    }
  }

  /**
   * Pulls from the database rather than the filesystem,
   * so may be slightly inaccurate.
   * @returns the total size of the cache in bytes
   */
  private async getDiskUsageInBytes() {
    const result = db
      .select({ total: sum(fileCache.bytes) })
      .from(fileCache)
      .get();
    const totalSizeBytes = Number(result?.total ?? 0);

    return totalSizeBytes;
  }

  /**
   * An efficient way to iterate over all rows.
   * @returns an iterable for the result of FileCache.findAll()
   */
  private getFindAllIterable() {
    const limit = 50;
    let previousCreatedAt: Date | null = null;

    let models: FileCache[] = [];

    const fetchNextBatch = async () => {
      models = db
        .select()
        .from(fileCache)
        .where(
          previousCreatedAt
            ? gt(fileCache.createdAt, previousCreatedAt)
            : undefined,
        )
        .orderBy(asc(fileCache.createdAt))
        .limit(limit)
        .all();

      const lastModel = models[models.length - 1];
      if (lastModel) {
        previousCreatedAt = lastModel.createdAt;
      }
    };

    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (models.length === 0) {
              await fetchNextBatch();
            }

            const value = models.shift();
            if (value === undefined) {
              // Must return value here for types to be inferred correctly
              return { done: true, value: null as unknown as FileCache };
            }

            return { value, done: false };
          },
        };
      },
    };
  }
}
