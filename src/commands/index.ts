import type { SharedSlashCommand } from "@discordjs/builders";
import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
} from "discord.js";

export default interface Command {
  readonly slashCommand: SharedSlashCommand;
  readonly handledButtonIds?: readonly string[];
  readonly requiresVC?:
    | boolean
    | ((interaction: ChatInputCommandInteraction) => boolean);
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  handleButtonInteraction?: (interaction: ButtonInteraction) => Promise<void>;
  handleAutocompleteInteraction?: (
    interaction: AutocompleteInteraction,
  ) => Promise<void>;
}
