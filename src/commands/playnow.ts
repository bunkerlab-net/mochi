import type { ChatInputCommandInteraction } from "discord.js";
import { inject, injectable, optional } from "inversify";
import type AddQueryToQueue from "../services/add-query-to-queue.js";
import type KeyValueCacheProvider from "../services/key-value-cache.js";
import type ThirdParty from "../services/third-party.js";
import { TYPES } from "../types.js";
import Play from "./play.js";

// /playnow is /play forced to the front of the queue with the current track
// skipped. It extends Play to inherit query autocomplete and the shared
// enqueue path, so its option handling can't drift from /play.
@injectable()
export default class extends Play {
  public override readonly slashCommand = this.buildSlashCommand({
    name: "playnow",
    description:
      "play a song now: add it to the front of the queue and skip the current track",
    includeImmediateAndSkip: false,
  });

  constructor(
    @inject(TYPES.ThirdParty) @optional() thirdParty: ThirdParty,
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider,
    @inject(TYPES.Services.AddQueryToQueue) addQueryToQueue: AddQueryToQueue,
  ) {
    super(thirdParty, cache, addQueryToQueue);
  }

  public override async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await this.enqueueQuery(interaction, {
      addToFrontOfQueue: true,
      skipCurrentTrack: true,
    });
  }
}
