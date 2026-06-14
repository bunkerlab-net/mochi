import { inject, injectable } from "inversify";
import type Autoplay from "../services/autoplay.js";
import type FileCacheProvider from "../services/file-cache.js";
import Player from "../services/player.js";
import { TYPES } from "../types.js";

@injectable()
export default class {
  private readonly guildPlayers: Map<string, Player>;
  private readonly fileCache: FileCacheProvider;
  private readonly autoplay: Autoplay;

  constructor(
    @inject(TYPES.FileCache) fileCache: FileCacheProvider,
    @inject(TYPES.Services.Autoplay) autoplay: Autoplay,
  ) {
    this.guildPlayers = new Map();
    this.fileCache = fileCache;
    this.autoplay = autoplay;
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(this.fileCache, guildId, this.autoplay);

      this.guildPlayers.set(guildId, player);
    }

    return player;
  }

  disconnectAll(): void {
    for (const player of this.guildPlayers.values()) {
      player.disconnect();
    }
  }
}
