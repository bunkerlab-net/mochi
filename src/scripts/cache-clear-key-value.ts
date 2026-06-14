import ora from "ora";
import { db } from "../db/index.js";
import { keyValueCache } from "../db/schema.js";

(async () => {
  const spinner = ora("Clearing key value cache...").start();

  db.delete(keyValueCache).run();

  spinner.succeed("Key value cache cleared.");
})();
