import type { BaseInteraction, Guild } from "discord.js";

const GUILD_ONLY_ERROR = "This command can only be used in a server.";

export const getGuild = (interaction: BaseInteraction): Guild => {
  if (!interaction.guild) {
    throw new Error(GUILD_ONLY_ERROR);
  }

  return interaction.guild;
};

export const getGuildId = (interaction: BaseInteraction): string =>
  getGuild(interaction).id;

export const getMemberUserId = (interaction: BaseInteraction): string => {
  const { member } = interaction;
  if (!member) {
    throw new Error(GUILD_ONLY_ERROR);
  }

  return member.user.id;
};
