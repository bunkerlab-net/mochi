import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../generated/prisma/client.js";
import { DATA_DIR } from "../services/config.js";
import createDatabaseUrl from "./create-database-url.js";

const adapter = new PrismaLibSql({
  url: process.env["DATABASE_URL"] ?? createDatabaseUrl(DATA_DIR),
});

export const prisma = new PrismaClient({ adapter });
