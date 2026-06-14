import { join } from "node:path";

export const createDatabasePath = (directory: string) =>
  join(directory, "db.sqlite");

const createDatabaseUrl = (directory: string) => {
  const databasePath = createDatabasePath(directory);

  if (process.platform === "win32") {
    return `file:${databasePath.replaceAll(/\\/g, "\\\\")}`;
  }

  return `file:${databasePath}`;
};

export default createDatabaseUrl;
