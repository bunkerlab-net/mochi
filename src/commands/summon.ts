import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import type PlayerManager from "../managers/player.js";
import { TYPES } from "../types.js";
import Join from "./join.js";

// Alias for /join: same behavior, a name people reach for out of habit.
//
// The constructor is re-declared (rather than inherited) on purpose: overriding
// only a field generates an implicit zero-arg constructor, so inversify would
// inject nothing and `playerManager` would be undefined at runtime.
@injectable()
export default class extends Join {
  public override readonly slashCommand = new SlashCommandBuilder()
    .setName("summon")
    .setDescription(
      "summon the bot to your voice channel and play the queue if it has music",
    );

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    super(playerManager);
  }
}
