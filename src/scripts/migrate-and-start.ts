// This script applies database migrations
// and then starts Mochi.
import { runMigrations } from "../db/index.js";
import { startBot } from "../index.js";
import logBanner from "../utils/log-banner.js";
import logger from "../utils/logger.js";

(async () => {
  // Banner
  logBanner();

  logger.info("migrate", "applying database migrations...");

  try {
    runMigrations();
  } catch (error) {
    logger.error("migrate", "failed to apply database migrations:");
    logger.error("migrate", error);
    process.exit(1);
  }

  logger.info("migrate", "database migrations applied");

  await startBot();
})();
