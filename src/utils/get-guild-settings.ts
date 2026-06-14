import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { type Setting, setting } from "../db/schema.js";
import { createGuildSettings } from "../events/guild-create.js";

export async function getGuildSettings(guildId: string): Promise<Setting> {
  const config = db
    .select()
    .from(setting)
    .where(eq(setting.guildId, guildId))
    .get();
  if (!config) {
    return createGuildSettings(guildId);
  }

  return config;
}
