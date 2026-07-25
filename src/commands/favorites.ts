import { SlashCommandBuilder } from "@discordjs/builders";
import type {
  APIEmbedField,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { Pagination } from "pagination.djs";
import { db } from "../db/index.js";
import { favoriteQuery } from "../db/schema.js";
import type AddQueryToQueue from "../services/add-query-to-queue.js";
import { TYPES } from "../types.js";
import { getGuild, getGuildId, getMemberUserId } from "../utils/interaction.js";
import type Command from "./index.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("favorites")
    .setDescription("add a song to your favorites")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("use")
        .setDescription("use a favorite")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("name of favorite")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addBooleanOption((option) =>
          option
            .setName("immediate")
            .setDescription("add track to the front of the queue"),
        )
        .addBooleanOption((option) =>
          option
            .setName("shuffle")
            .setDescription(
              "shuffle the input if you're adding multiple tracks",
            ),
        )
        .addBooleanOption((option) =>
          option
            .setName("split")
            .setDescription("if a track has chapters, split it"),
        )
        .addBooleanOption((option) =>
          option
            .setName("skip")
            .setDescription("skip the currently playing track"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("list all favorites"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("create a new favorite")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("you'll type this when using this favorite")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("any input you'd normally give to the play command")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("remove a favorite")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("name of favorite")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    );

  constructor(
    @inject(TYPES.Services.AddQueryToQueue)
    private readonly addQueryToQueue: AddQueryToQueue,
  ) {}

  requiresVC = (interaction: ChatInputCommandInteraction) =>
    interaction.options.getSubcommand() === "use";

  async execute(interaction: ChatInputCommandInteraction) {
    switch (interaction.options.getSubcommand()) {
      case "use":
        await this.use(interaction);
        break;
      case "list":
        await this.list(interaction);
        break;
      case "create":
        await this.create(interaction);
        break;
      case "remove":
        await this.remove(interaction);
        break;
      default:
        throw new Error("unknown subcommand");
    }
  }

  async handleAutocompleteInteraction(interaction: AutocompleteInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const query = interaction.options.getString("name", true).trim();

    const favorites = db
      .select()
      .from(favoriteQuery)
      .where(eq(favoriteQuery.guildId, getGuildId(interaction)))
      .all();

    let results =
      query === ""
        ? favorites
        : favorites.filter((f) =>
            f.name.toLowerCase().startsWith(query.toLowerCase()),
          );

    if (subcommand === "remove") {
      // Only show favorites that user is allowed to remove
      results =
        interaction.member?.user.id === interaction.guild?.ownerId
          ? results
          : results.filter((r) => r.authorId === getMemberUserId(interaction));
    }

    // Limit results to 25 maximum per Discord limits
    const trimmed = results.length > 25 ? results.slice(0, 25) : results;
    await interaction.respond(
      trimmed.map((r) => ({
        name: r.name,
        value: r.name,
      })),
    );
  }

  private async use(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString("name", true).trim();

    const favorite = db
      .select()
      .from(favoriteQuery)
      .where(
        and(
          eq(favoriteQuery.name, name),
          eq(favoriteQuery.guildId, getGuildId(interaction)),
        ),
      )
      .get();

    if (!favorite) {
      throw new Error("no favorite with that name exists");
    }

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: favorite.query,
      shuffleAdditions: interaction.options.getBoolean("shuffle") ?? false,
      addToFrontOfQueue: interaction.options.getBoolean("immediate") ?? false,
      shouldSplitChapters: interaction.options.getBoolean("split") ?? false,
      skipCurrentTrack: interaction.options.getBoolean("skip") ?? false,
      // /favorites use exposes no mix or autoplay options, so it stays on the
      // guild autoplay setting and queues the query as-is.
      queueMix: false,
      sessionAutoplay: null,
    });
  }

  private async list(interaction: ChatInputCommandInteraction) {
    const favorites = db
      .select()
      .from(favoriteQuery)
      .where(eq(favoriteQuery.guildId, getGuildId(interaction)))
      .all();

    if (favorites.length === 0) {
      await interaction.reply("there aren't any favorites yet");
      return;
    }

    const fields = new Array<APIEmbedField>(favorites.length);
    favorites.forEach((favorite, index) => {
      fields[index] = {
        inline: false,
        name: favorite.name,
        value: `${favorite.query} (<@${favorite.authorId}>)`,
      };
    });

    await new Pagination(interaction as ChatInputCommandInteraction<"cached">, {
      ephemeral: true,
      limit: 25,
    })
      .setFields(fields)
      .paginateFields(true)
      .render();
  }

  private async create(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString("name", true).trim();
    const query = interaction.options.getString("query", true).trim();

    const existingFavorite = db
      .select()
      .from(favoriteQuery)
      .where(
        and(
          eq(favoriteQuery.guildId, getGuildId(interaction)),
          eq(favoriteQuery.name, name),
        ),
      )
      .get();

    if (existingFavorite) {
      throw new Error("a favorite with that name already exists");
    }

    db.insert(favoriteQuery)
      .values({
        authorId: getMemberUserId(interaction),
        guildId: getGuildId(interaction),
        name,
        query,
      })
      .run();

    await interaction.reply("👍 favorite created");
  }

  private async remove(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString("name", true).trim();

    const favorite = db
      .select()
      .from(favoriteQuery)
      .where(
        and(
          eq(favoriteQuery.name, name),
          eq(favoriteQuery.guildId, getGuildId(interaction)),
        ),
      )
      .get();

    if (!favorite) {
      throw new Error("no favorite with that name exists");
    }

    const isUserGuildOwner =
      getMemberUserId(interaction) === getGuild(interaction).ownerId;

    if (
      favorite.authorId !== getMemberUserId(interaction) &&
      !isUserGuildOwner
    ) {
      throw new Error("you can only remove your own favorites");
    }

    db.delete(favoriteQuery).where(eq(favoriteQuery.id, favorite.id)).run();

    await interaction.reply("👍 favorite removed");
  }
}
