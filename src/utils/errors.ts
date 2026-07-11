// Thrown by the player's queue-advance methods (forward()/manualForward()) when
// there is no track to advance to. It lives in this leaf module so both the
// player and the add-to-queue service can reference it without the service
// depending on the player's playback-recovery module.
export class NoNextTrackError extends Error {
  constructor() {
    super("No songs in queue to forward to.");
    this.name = "NoNextTrackError";
  }
}
