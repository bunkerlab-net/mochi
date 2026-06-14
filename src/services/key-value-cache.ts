import { eq } from "drizzle-orm";
import { injectable } from "inversify";
import { db } from "../db/index.js";
import { keyValueCache } from "../db/schema.js";
import logger from "../utils/logger.js";

type Seconds = number;

type Options = {
  expiresIn: Seconds;
  key?: string;
};

const futureTimeToDate = (time: Seconds) => new Date(Date.now() + time * 1000);

@injectable()
export default class KeyValueCacheProvider {
  async wrap<T extends [...unknown[], Options], F>(
    func: (...args: never[]) => Promise<F>,
    ...options: T
  ): Promise<F> {
    if (options.length === 0) {
      throw new Error("Missing cache options");
    }

    const functionArgs = options.slice(0, options.length - 1);

    const { key = JSON.stringify(functionArgs), expiresIn } = options[
      options.length - 1
    ] as Options;

    if (key.length < 4) {
      throw new Error(`Cache key ${key} is too short.`);
    }

    const cachedResult = db
      .select()
      .from(keyValueCache)
      .where(eq(keyValueCache.key, key))
      .get();

    if (cachedResult) {
      if (new Date() < cachedResult.expiresAt) {
        logger.debug("cache", `cache hit: ${key}`);
        return JSON.parse(cachedResult.value) as F;
      }

      db.delete(keyValueCache).where(eq(keyValueCache.key, key)).run();
    }

    logger.debug("cache", `cache miss: ${key}`);

    const result = await func(...(options as unknown as never[]));

    // Save result
    const value = JSON.stringify(result);
    const expiresAt = futureTimeToDate(expiresIn);
    db.insert(keyValueCache)
      .values({ key, value, expiresAt })
      .onConflictDoUpdate({
        target: keyValueCache.key,
        set: { value, expiresAt, updatedAt: new Date() },
      })
      .run();

    return result;
  }
}
