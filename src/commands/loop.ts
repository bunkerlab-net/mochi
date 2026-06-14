import { SlashCommandBuilder } from "@discordjs/builders";
import type { ChatInputCommandInteraction } from "discord.js";
import { inject, injectable } from "inversify";
import type PlayerManager from "../managers/player.js";
import { STATUS } from "../services/player.js";
import { TYPES } from "../types.js";
import { getGuildId } from "../utils/interaction.js";
import type Command from "./index.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("loop")
    .setDescription("toggle looping the current song");

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const player = this.playerManager.get(getGuildId(interaction));

    if (player.status === STATUS.IDLE) {
      throw new Error("no song to loop!");
    }

    if (player.loopCurrentQueue) {
      player.loopCurrentQueue = false;
    }

    player.loopCurrentSong = !player.loopCurrentSong;

    await interaction.reply(
      player.loopCurrentSong ? "looped :)" : "stopped looping :(",
    );
  }
}
