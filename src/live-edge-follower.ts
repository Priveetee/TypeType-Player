import type { LivePlaybackWindow } from "./manifest";

type CatchUpContext = {
  positionMs: number;
  live: LivePlaybackWindow | null | undefined;
  paused: boolean;
  busy: boolean;
  nowMs: number;
};

const MAX_TARGET_DRIFT_MS = 20_000;
const REJOIN_TOLERANCE_MS = 5_000;
const CATCH_UP_COOLDOWN_MS = 15_000;

export class LiveEdgeFollower {
  private initialized = false;
  private following = false;
  private nextCatchUpAtMs = 0;

  constructor(private readonly enabled: boolean) {}

  initialize(positionMs: number, live: LivePlaybackWindow | null | undefined): void {
    if (this.initialized || !this.enabled || live?.active !== true) return;
    this.initialized = true;
    this.following = live.atLiveEdge || this.isNearTarget(positionMs, live);
  }

  observeUserSeek(positionMs: number, live: LivePlaybackWindow | null | undefined): void {
    this.nextCatchUpAtMs = 0;
    this.following = this.enabled && live?.active === true && this.isNearTarget(positionMs, live);
  }

  nextTarget(context: CatchUpContext): number | null {
    if (
      !this.following ||
      context.live?.active !== true ||
      context.paused ||
      context.busy ||
      context.nowMs < this.nextCatchUpAtMs
    ) {
      return null;
    }
    const targetMs = liveTargetMs(context.live);
    if (targetMs - context.positionMs <= MAX_TARGET_DRIFT_MS) return null;
    this.nextCatchUpAtMs = context.nowMs + CATCH_UP_COOLDOWN_MS;
    return targetMs;
  }

  get isFollowing(): boolean {
    return this.following;
  }

  private isNearTarget(positionMs: number, live: LivePlaybackWindow): boolean {
    return positionMs >= liveTargetMs(live) - REJOIN_TOLERANCE_MS;
  }
}

function liveTargetMs(live: LivePlaybackWindow): number {
  return Math.max(live.seekableStartMs, live.seekableEndMs - live.targetLatencyMs);
}
