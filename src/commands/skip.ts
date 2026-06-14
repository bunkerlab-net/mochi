import { SlashCommandBuilder } from "@discordjs/builders";
import type { ChatInputCommandInteraction } from "discord.js";
import { inject, injectable } from "inversify";
import type PlayerManager from "../managers/player.js";
import { TYPES } from "../types.js";
import { buildPlayingMessageEmbed } from "../utils/build-embed.js";
import { getGuildId } from "../utils/interaction.js";
import type Command from "./index.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("skip")
    .setDescription("skip the next songs")
    .addIntegerOption((option) =>
      option
        .setName("number")
        .setDescription("number of songs to skip [default: 1]")
        .setRequired(false),
    );

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const numToSkip = interaction.options.getInteger("number") ?? 1;

    if (numToSkip < 1) {
      throw new Error("invalid number of songs to skip");
    }

    const player = this.playerManager.get(getGuildId(interaction));

    try {
      // Defer up front: forwarding resolves the next track's media URL, which
      // can take longer than Discord's 3s interaction ack window.
      await Promise.all([player.forward(numToSkip), interaction.deferReply()]);
    } catch (_: unknown) {
      throw new Error("no song to skip to");
    }

    await interaction.editReply({
      content: "keep 'er movin'",
      embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [],
    });
  }
}
