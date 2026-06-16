import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { type PlayerState, playerState } from "../db/schema.js";
import type { QueuedSong, STATUS } from "../services/player.js";

// Snapshot the player writes; createdAt/updatedAt are managed by the schema.
export interface PlayerStateSnapshot {
  guildId: string;
  voiceChannelId: string | null;
  queue: QueuedSong[];
  queuePosition: number;
  positionInSeconds: number;
  status: STATUS;
  loopCurrentSong: boolean;
  loopCurrentQueue: boolean;
  volume: number | null;
}

export function loadPlayerState(guildId: string): PlayerState | undefined {
  return db
    .select()
    .from(playerState)
    .where(eq(playerState.guildId, guildId))
    .get();
}

export function loadAllPlayerStates(): PlayerState[] {
  return db.select().from(playerState).all();
}

export function savePlayerState(snapshot: PlayerStateSnapshot): void {
  db.insert(playerState)
    .values(snapshot)
    .onConflictDoUpdate({
      target: playerState.guildId,
      set: {
        voiceChannelId: snapshot.voiceChannelId,
        queue: snapshot.queue,
        queuePosition: snapshot.queuePosition,
        positionInSeconds: snapshot.positionInSeconds,
        status: snapshot.status,
        loopCurrentSong: snapshot.loopCurrentSong,
        loopCurrentQueue: snapshot.loopCurrentQueue,
        volume: snapshot.volume,
        updatedAt: new Date(),
      },
    })
    .run();
}

export function clearPlayerState(guildId: string): void {
  db.delete(playerState).where(eq(playerState.guildId, guildId)).run();
}
