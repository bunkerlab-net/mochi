import { SlashCommandBuilder } from "@discordjs/builders";
import type { ChatInputCommandInteraction } from "discord.js";
import { eq } from "drizzle-orm";
import { injectable } from "inversify";
import { db } from "../db/index.js";
import { setting } from "../db/schema.js";
import { getGuildSettings } from "../utils/get-guild-settings.js";
import { getGuildId } from "../utils/interaction.js";
import type Command from "./index.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription(
      "toggle automatically playing similar music when the queue ends",
    );

  public requiresVC = false;

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const guildId = getGuildId(interaction);

    const settings = await getGuildSettings(guildId);
    const autoplay = !settings.autoplay;

    db.update(setting)
      .set({ autoplay })
      .where(eq(setting.guildId, guildId))
      .run();

    await interaction.reply(
      autoplay
        ? "autoplay on — i'll keep finding similar music when the queue ends :)"
        : "autoplay off — i'll stop when the queue runs dry :(",
    );
  }
}
