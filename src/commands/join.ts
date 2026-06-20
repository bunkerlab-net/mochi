import { SlashCommandBuilder } from "@discordjs/builders";
import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { inject, injectable } from "inversify";
import type PlayerManager from "../managers/player.js";
import { TYPES } from "../types.js";
import {
  getMemberVoiceChannel,
  getMostPopularVoiceChannel,
} from "../utils/channels.js";
import { getGuild, getGuildId } from "../utils/interaction.js";
import type Command from "./index.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("join")
    .setDescription(
      "join your voice channel and play the queue if it has music",
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

    const [targetVoiceChannel] =
      getMemberVoiceChannel(interaction.member as GuildMember) ??
      getMostPopularVoiceChannel(getGuild(interaction));

    await interaction.deferReply();
    await player.connect(targetVoiceChannel);

    // Resume the queue if there's anything to play; otherwise just sit in the
    // channel.
    if (player.getCurrent()) {
      await player.play();
      await interaction.editReply("hai, joined and playing the queue");
      return;
    }

    await interaction.editReply("hai, joined");
  }
}
