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
    .setName("remove")
    .setDescription("remove songs from the queue")
    .addIntegerOption((option) =>
      option
        .setName("position")
        .setDescription("position of the song to remove [default: 1]")
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("range")
        .setDescription("number of songs to remove [default: 1]")
        .setRequired(false),
    );

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const player = this.playerManager.get(getGuildId(interaction));

    const position = interaction.options.getInteger("position") ?? 1;
    const range = interaction.options.getInteger("range") ?? 1;

    if (position < 1) {
      throw new Error("position must be at least 1");
    }

    if (range < 1) {
      throw new Error("range must be at least 1");
    }

    player.removeFromQueue(position, range);

    await interaction.reply(":wastebasket: removed");
  }
}
