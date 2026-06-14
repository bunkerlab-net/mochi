import path from "node:path";
import { makeDirectory } from "make-dir";
import type Bot from "./bot.js";
import container from "./inversify.config.js";
import type Config from "./services/config.js";
import type FileCacheProvider from "./services/file-cache.js";
import { TYPES } from "./types.js";
import prepareYtDlp from "./utils/prepare-yt-dlp.js";

const bot = container.get<Bot>(TYPES.Bot);

const startBot = async () => {
  // Create data directories if necessary
  const config = container.get<Config>(TYPES.Config);

  await makeDirectory(config.DATA_DIR);
  await makeDirectory(config.CACHE_DIR);
  await makeDirectory(path.join(config.CACHE_DIR, "tmp"));

  await container.get<FileCacheProvider>(TYPES.FileCache).cleanup();
  await prepareYtDlp(config);

  await bot.register();
};

export { startBot };
