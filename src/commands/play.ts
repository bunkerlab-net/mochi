import { URL } from "node:url";
import {
  type SharedSlashCommand,
  SlashCommandBuilder,
} from "@discordjs/builders";
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import { inject, injectable, optional } from "inversify";
import type Spotify from "spotify-web-api-node";
import type AddQueryToQueue from "../services/add-query-to-queue.js";
import type KeyValueCacheProvider from "../services/key-value-cache.js";
import type ThirdParty from "../services/third-party.js";
import { TYPES } from "../types.js";
import { ONE_HOUR_IN_SECONDS } from "../utils/constants.js";
import getYouTubeAndSpotifySuggestionsFor, {
  SpotifySuggestionsUnavailableError,
} from "../utils/get-youtube-and-spotify-suggestions-for.js";
import type Command from "./index.js";

@injectable()
export default class implements Command {
  public readonly slashCommand: SharedSlashCommand;

  public requiresVC = true;

  private readonly spotify?: Spotify;
  private readonly cache: KeyValueCacheProvider;
  private readonly addQueryToQueue: AddQueryToQueue;

  constructor(
    @inject(TYPES.ThirdParty) @optional() thirdParty: ThirdParty,
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider,
    @inject(TYPES.Services.AddQueryToQueue) addQueryToQueue: AddQueryToQueue,
  ) {
    this.spotify = thirdParty?.spotify;
    this.cache = cache;
    this.addQueryToQueue = addQueryToQueue;

    this.slashCommand = new SlashCommandBuilder()
      .setName("play")
      .setDescription("play a song")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription(this.queryDescription())
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName("immediate")
          .setDescription("add track to the front of the queue"),
      )
      .addBooleanOption((option) =>
        option
          .setName("shuffle")
          .setDescription("shuffle the input if you're adding multiple tracks"),
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
      );
  }

  // Query-option help text reflecting whether Spotify lookups are available.
  // Shared with subclasses (e.g. /playnow) so the described capabilities can't
  // drift from what's actually configured.
  protected queryDescription(): string {
    return this.spotify
      ? "YouTube URL, Spotify URL, or search query"
      : "YouTube URL or search query";
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await this.enqueueQuery(interaction, {
      addToFrontOfQueue: interaction.options.getBoolean("immediate") ?? false,
      skipCurrentTrack: interaction.options.getBoolean("skip") ?? false,
    });
  }

  // Shared enqueue path for /play and its variants (e.g. /playnow). Reads the
  // query and the shuffle/split options here so subclasses can't drift from
  // that handling; the front-of-queue and skip flags are supplied by the
  // caller.
  protected async enqueueQuery(
    interaction: ChatInputCommandInteraction,
    {
      addToFrontOfQueue,
      skipCurrentTrack,
    }: { addToFrontOfQueue: boolean; skipCurrentTrack: boolean },
  ): Promise<void> {
    const query = interaction.options.getString("query", true);

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: query.trim(),
      addToFrontOfQueue,
      shuffleAdditions: interaction.options.getBoolean("shuffle") ?? false,
      shouldSplitChapters: interaction.options.getBoolean("split") ?? false,
      skipCurrentTrack,
    });
  }

  public async handleAutocompleteInteraction(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const query = interaction.options.getString("query")?.trim();

    if (!query || query.length === 0) {
      await interaction.respond([]);
      return;
    }

    // Don't return suggestions for URLs
    if (URL.canParse(query)) {
      await interaction.respond([]);
      return;
    }

    let suggestions: Awaited<
      ReturnType<typeof getYouTubeAndSpotifySuggestionsFor>
    >;

    try {
      suggestions = await this.cache.wrap(
        getYouTubeAndSpotifySuggestionsFor,
        query,
        this.spotify,
        10,
        {
          expiresIn: ONE_HOUR_IN_SECONDS,
          key: `autocomplete:${query}`,
        },
      );
    } catch (error: unknown) {
      if (error instanceof SpotifySuggestionsUnavailableError) {
        suggestions = error.suggestions;
      } else {
        throw error;
      }
    }

    await interaction.respond(suggestions);
  }
}
