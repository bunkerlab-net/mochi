// This script applies Prisma migrations
// and then starts Mochi.
import { promises as fs } from "node:fs";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { type ExecaError, execa } from "execa";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { startBot } from "../index.js";
import { DATA_DIR } from "../services/config.js";
import createDatabaseUrl, {
  createDatabasePath,
} from "../utils/create-database-url.js";
import logBanner from "../utils/log-banner.js";
import logger from "../utils/logger.js";

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? createDatabaseUrl(DATA_DIR);

const migrateFromSequelizeToPrisma = async () => {
  await execa(
    "prisma",
    [
      "migrate",
      "resolve",
      "--applied",
      "20220101155430_migrate_from_sequelize",
    ],
    { preferLocal: true },
  );
};

const doesUserHaveExistingDatabase = async () => {
  try {
    await fs.access(createDatabasePath(DATA_DIR));

    return true;
  } catch {
    return false;
  }
};

const hasDatabaseBeenMigratedToPrisma = async () => {
  const adapter = new PrismaLibSql({
    url: process.env["DATABASE_URL"] ?? createDatabaseUrl(DATA_DIR),
  });
  const client = new PrismaClient({ adapter });

  try {
    await client.$queryRaw`SELECT COUNT(id) FROM _prisma_migrations`;
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2010"
    ) {
      // Table doesn't exist
      await client.$disconnect();
      return false;
    }

    await client.$disconnect();
    throw error;
  }

  await client.$disconnect();
  return true;
};

(async () => {
  // Banner
  logBanner();

  logger.info("migrate", "applying database migrations...");

  if (await doesUserHaveExistingDatabase()) {
    if (!(await hasDatabaseBeenMigratedToPrisma())) {
      try {
        await migrateFromSequelizeToPrisma();
      } catch (error) {
        if ((error as ExecaError).stderr) {
          logger.error(
            "migrate",
            "failed to apply database migrations (going from Sequelize to Prisma):",
          );
          logger.error("migrate", (error as ExecaError).stderr);
          process.exit(1);
        } else {
          throw error;
        }
      }
    }
  }

  try {
    await execa("prisma", ["migrate", "deploy"], { preferLocal: true });
  } catch (error: unknown) {
    if ((error as ExecaError).stderr) {
      logger.error("migrate", "failed to apply database migrations:");
      logger.error("migrate", (error as ExecaError).stderr);
      process.exit(1);
    } else {
      throw error;
    }
  }

  logger.info("migrate", "database migrations applied");

  await startBot();
})();
