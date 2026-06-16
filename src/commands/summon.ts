import { SlashCommandBuilder } from "@discordjs/builders";
import { injectable } from "inversify";
import Join from "./join.js";

// Alias for /join: same behavior, a name people reach for out of habit.
@injectable()
export default class extends Join {
  public override readonly slashCommand = new SlashCommandBuilder()
    .setName("summon")
    .setDescription(
      "summon the bot to your voice channel and play the queue if it has music",
    );
}
