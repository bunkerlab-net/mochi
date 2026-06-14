import { createGuildSettings } from "../events/guild-create.js";
import type { Setting } from "../generated/prisma/client.js";
import { prisma } from "./db.js";

export async function getGuildSettings(guildId: string): Promise<Setting> {
  const config = await prisma.setting.findUnique({ where: { guildId } });
  if (!config) {
    return createGuildSettings(guildId);
  }

  return config;
}
