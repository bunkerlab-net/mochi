import { makeLines } from "nodesplash";
import { readPackageSync } from "read-pkg";
import logger from "./logger.js";

const logBanner = () => {
  const buildDate = process.env["BUILD_DATE"];
  logger.info(
    "mochi",
    `\n${makeLines({
      user: "bunkerlab-net",
      repository: "mochi",
      version: readPackageSync().version,
      madeByPrefix: "Made with 🎶 by ",
      ...(buildDate ? { buildDate: new Date(buildDate) } : {}),
      commit: process.env["COMMIT_HASH"] ?? "unknown",
    }).join("\n")}`,
  );
};

export default logBanner;
