import { makeLines } from "nodesplash";
import { readPackageSync } from "read-pkg";

const logBanner = () => {
  const buildDate = process.env["BUILD_DATE"];
  console.log(
    makeLines({
      user: "bunkerlab-net",
      repository: "mochi",
      version: readPackageSync().version,
      madeByPrefix: "Made with 🎶 by ",
      ...(buildDate ? { buildDate: new Date(buildDate) } : {}),
      commit: process.env["COMMIT_HASH"] ?? "unknown",
    }).join("\n"),
  );
  console.log("\n");
};

export default logBanner;
