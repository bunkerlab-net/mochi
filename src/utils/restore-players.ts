import type { Client, VoiceChannel } from "discord.js";
import container from "../inversify.config.js";
import type PlayerManager from "../managers/player.js";
import { STATUS } from "../services/player.js";
import { TYPES } from "../types.js";
import logger from "./logger.js";
import { loadAllPlayerStates } from "./player-state.js";

// Restore persisted queues and rejoin voice channels after a restart. Runs once
// the client is ready. Each guild is restored independently so one failure
// (e.g. a deleted channel) does not block the others.
export default async function restorePlayers(): Promise<void> {
  const states = loadAllPlayerStates();
  if (states.length === 0) {
    return;
  }

  const client = container.get<Client>(TYPES.Client);
  const playerManager = container.get<PlayerManager>(TYPES.Managers.Player);

  logger.info("restore", `restoring ${states.length} player(s) from last run`);

  await Promise.all(
    states.map(async (state) => {
      try {
        const player = playerManager.get(state.guildId);
        player.restoreState(state);

        if (!state.voiceChannelId) {
          return;
        }

        const channel = await client.channels.fetch(state.voiceChannelId);
        if (!channel?.isVoiceBased()) {
          logger.warn(
            "restore",
            `voice channel ${state.voiceChannelId} for guild ${state.guildId} is gone; kept the queue but did not rejoin`,
          );
          return;
        }

        await player.connect(channel as VoiceChannel);

        // Resume playback only if it was actively playing. A paused player is
        // left primed so /resume picks up at the saved position.
        if (state.status === STATUS.PLAYING && player.getCurrent()) {
          await player.play();
        }

        logger.info(
          "restore",
          `rejoined "${channel.name}" in guild ${state.guildId}`,
        );
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(
          "restore",
          `failed to restore guild ${state.guildId}: ${reason}`,
        );
      }
    }),
  );
}
