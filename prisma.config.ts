import { join, resolve } from "node:path";
import { defineConfig } from "prisma/config";

const dataDir = resolve(process.env["DATA_DIR"] ?? "./data");
const databaseUrl =
  process.env["DATABASE_URL"] ?? `file:${join(dataDir, "db.sqlite")}`;

export default defineConfig({
  schema: "schema.prisma",
  migrations: {
    path: "migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
