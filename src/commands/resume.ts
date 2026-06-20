import { SlashCommandBuilder } from "@discordjs/builders";
import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { inject, injectable } from "inversify";
import type PlayerManager from "../managers/player.js";
import { STATUS } from "../services/player.js";
import { TYPES } from "../types.js";
import { buildPlayingMessageEmbed } from "../utils/build-embed.js";
import {
  getMemberVoiceChannel,
  getMostPopularVoiceChannel,
} from "../utils/channels.js";
import { getGuild, getGuildId } from "../utils/interaction.js";
import type Command from "./index.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("resume")
    .setDescription("resume playback");

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
    if (player.status === STATUS.PLAYING) {
      throw new Error("already playing, give me a song name");
    }

    // Must be resuming play
    if (!player.getCurrent()) {
      throw new Error("nothing to play");
    }

    // Defer before (re)connecting and starting playback, which can take longer
    // than Discord's 3s interaction ack window.
    await interaction.deferReply();

    await player.connect(targetVoiceChannel);
    await player.play();

    await interaction.editReply({
      content: "the paper lantern glows again",
      embeds: [buildPlayingMessageEmbed(player)],
    });
  }
}
