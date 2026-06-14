import { SlashCommandBuilder } from "@discordjs/builders";
import type { ChatInputCommandInteraction } from "discord.js";
import { inject, injectable } from "inversify";
import type PlayerManager from "../managers/player.js";
import { TYPES } from "../types.js";
import { getGuildId } from "../utils/interaction.js";
import type Command from "./index.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("volume")
    .setDescription("set current player volume level")
    .addIntegerOption((option) =>
      option
        .setName("level")
        .setDescription("volume percentage (0 is muted, 100 is max & default)")
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true),
    );

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const player = this.playerManager.get(getGuildId(interaction));

    const currentSong = player.getCurrent();

    if (!currentSong) {
      throw new Error("nothing is playing");
    }

    const level = interaction.options.getInteger("level") ?? 100;
    player.setVolume(level);
    await interaction.reply(`Set volume to ${level}%`);
  }
}
