import path from "node:path";
import { makeDirectory } from "make-dir";
import type Bot from "./bot.js";
import container from "./inversify.config.js";
import type PlayerManager from "./managers/player.js";
import type Config from "./services/config.js";
import type FileCacheProvider from "./services/file-cache.js";
import { TYPES } from "./types.js";
import logger from "./utils/logger.js";
import prepareYtDlp from "./utils/prepare-yt-dlp.js";

const bot = container.get<Bot>(TYPES.Bot);

// On SIGINT/SIGTERM, leave voice channels and close the Discord connection
// before exiting. A second signal during teardown is ignored so it runs once.
const registerShutdownHandlers = () => {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info("shutdown", `received ${signal}, shutting down`);

    try {
      const playerManager = container.get<PlayerManager>(TYPES.Managers.Player);
      playerManager.saveAndFreezeAll();
      playerManager.disconnectAll();
      await bot.shutdown();
    } catch (error) {
      logger.error("shutdown", error);
    }

    process.exit(0);
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, (received) => {
      void shutdown(received);
    });
  }
};

const startBot = async () => {
  // Create data directories if necessary
  const config = container.get<Config>(TYPES.Config);

  await makeDirectory(config.DATA_DIR);
  await makeDirectory(config.CACHE_DIR);
  await makeDirectory(path.join(config.CACHE_DIR, "tmp"));

  await container.get<FileCacheProvider>(TYPES.FileCache).cleanup();
  await prepareYtDlp(config);

  await bot.register();

  registerShutdownHandlers();
};

export { startBot };
