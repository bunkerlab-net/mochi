import { SlashCommandBuilder } from "@discordjs/builders";
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { eq } from "drizzle-orm";
import { injectable } from "inversify";
import { db } from "../db/index.js";
import { type Setting, setting } from "../db/schema.js";
import {
  CONFIG_SETTING_CHOICES,
  CONFIG_SETTINGS,
  CONFIG_SETTINGS_BY_KEY,
  describeAllowedValues,
  formatSettingValue,
  parseSettingValue,
} from "../utils/config-settings.js";
import { getGuildSettings } from "../utils/get-guild-settings.js";
import { getGuildId } from "../utils/interaction.js";
import type Command from "./index.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("config")
    .setDescription("view and change bot settings")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand((subcommand) =>
      subcommand
        .setName("get")
        .setDescription("show the current settings")
        .addStringOption((option) =>
          option
            .setName("key")
            .setDescription("a single setting to view (omit to show all)")
            .addChoices(...CONFIG_SETTING_CHOICES),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("change a setting")
        .addStringOption((option) =>
          option
            .setName("key")
            .setDescription("the setting to change")
            .setRequired(true)
            .addChoices(...CONFIG_SETTING_CHOICES),
        )
        .addStringOption((option) =>
          option
            .setName("value")
            .setDescription("the new value (true/false, or a number)")
            .setRequired(true),
        ),
    );

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Ensure the guild's settings row exists before reading or updating it.
    await getGuildSettings(getGuildId(interaction));

    switch (interaction.options.getSubcommand()) {
      case "get":
        await this.showSettings(interaction);
        break;
      case "set":
        await this.setSetting(interaction);
        break;
      default:
        throw new Error("unknown subcommand");
    }
  }

  private async setSetting(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const key = interaction.options.getString("key", true);
    const definition = CONFIG_SETTINGS_BY_KEY[key];
    if (!definition) {
      throw new Error(`unknown setting \`${key}\``);
    }

    const value = parseSettingValue(
      definition,
      interaction.options.getString("value", true),
    );

    // `definition.column` is a validated `setting` column and `value` matches
    // its declared type, but drizzle types each column individually, so a
    // dynamic column key can't be expressed without a cast.
    const update = {
      [definition.column]: value,
    } as unknown as Partial<Setting>;
    db.update(setting)
      .set(update)
      .where(eq(setting.guildId, getGuildId(interaction)))
      .run();

    await interaction.reply({
      content: `👍 **${definition.label}** is now **${formatSettingValue(definition, value)}**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async showSettings(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const config = await getGuildSettings(getGuildId(interaction));
    const key = interaction.options.getString("key");

    if (key) {
      const definition = CONFIG_SETTINGS_BY_KEY[key];
      if (!definition) {
        throw new Error(`unknown setting \`${key}\``);
      }

      const embed = new EmbedBuilder()
        .setTitle(definition.label)
        .setDescription(definition.description)
        .addFields(
          {
            name: "Current value",
            value: `\`${formatSettingValue(definition, config[definition.column])}\``,
            inline: true,
          },
          {
            name: "Accepts",
            value: describeAllowedValues(definition),
            inline: true,
          },
          {
            name: "Change it",
            value: `\`/config set key:${definition.key} value:<new value>\``,
          },
        );

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Config")
      .setDescription(
        CONFIG_SETTINGS.map(
          (definition) =>
            `**${definition.label}** — \`${definition.key}\`\n${formatSettingValue(definition, config[definition.column])}`,
        ).join("\n\n"),
      )
      .setFooter({
        text: "Change a value with /config set <key> <value> · details with /config get <key>",
      });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }
}
