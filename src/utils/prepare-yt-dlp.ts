import type Config from "../services/config.js";
import logger from "./logger.js";
import { getExecutable, getYtDlpVersion, updateYtDlp } from "./yt-dlp.js";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "unknown error";

const logUnavailableVersion = (error: unknown) => {
  logger.warn(
    "yt-dlp",
    `YT_DLP_VERSION=unavailable (${getExecutable()}: ${getErrorMessage(error)})`,
  );
};

export default async function prepareYtDlp(config: Config): Promise<void> {
  if (!config.YT_DLP_AUTO_UPDATE) {
    try {
      logger.info(
        "yt-dlp",
        `YT_DLP_VERSION=${await getYtDlpVersion()} (${getExecutable()})`,
      );
    } catch (error: unknown) {
      logUnavailableVersion(error);
    }

    return;
  }

  logger.info("yt-dlp", `YT_DLP_AUTO_UPDATE=true (${getExecutable()})`);

  const updateResult = await updateYtDlp();
  if (updateResult.error) {
    logger.warn("yt-dlp", `yt-dlp update warning: ${updateResult.error}`);
  }

  if (!updateResult.afterVersion) {
    logger.warn("yt-dlp", "YT_DLP_VERSION=unavailable after auto-update");
    return;
  }

  if (updateResult.updated && updateResult.beforeVersion) {
    logger.info(
      "yt-dlp",
      `YT_DLP_VERSION=${updateResult.afterVersion} (updated from ${updateResult.beforeVersion})`,
    );
    return;
  }

  if (!updateResult.updateSucceeded) {
    logger.info(
      "yt-dlp",
      `YT_DLP_VERSION=${updateResult.afterVersion} (update failed; continuing with installed version)`,
    );
    return;
  }

  logger.info(
    "yt-dlp",
    `YT_DLP_VERSION=${updateResult.afterVersion} (already current)`,
  );
}
