import { SlashCommandBuilder } from "@discordjs/builders";
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { injectable } from "inversify";
import container from "../inversify.config.js";
import { TYPES } from "../types.js";
import type Command from "./index.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("help")
    .setDescription("list all commands and what they do");

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Built from the live command registry so the list never drifts from the
    // commands that are actually registered.
    const commandList = container
      .getAll<Command>(TYPES.Command)
      .map((command) => ({
        name: command.slashCommand.name,
        description: command.slashCommand.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, description }) => `**/${name}** — ${description}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("Mochi commands")
      .setDescription(
        `Here's everything I can do — type \`/\` and pick a command.\n\n${commandList}`,
      );

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }
}
