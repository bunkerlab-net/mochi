import { SlashCommandBuilder } from "@discordjs/builders";
import { injectable } from "inversify";
import Skip from "./skip.js";

@injectable()
export default class extends Skip {
  public override readonly slashCommand = new SlashCommandBuilder()
    .setName("next")
    .setDescription("skip to the next song");
}
