import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import type PlayerManager from "../managers/player.js";
import { TYPES } from "../types.js";
import Skip from "./skip.js";

// Alias for /skip. The constructor is re-declared (rather than inherited)
// because overriding only a field generates an implicit zero-arg constructor,
// so inversify would inject nothing and `playerManager` would be undefined.
@injectable()
export default class extends Skip {
  public override readonly slashCommand = new SlashCommandBuilder()
    .setName("next")
    .setDescription("skip to the next song");

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    super(playerManager);
  }
}
