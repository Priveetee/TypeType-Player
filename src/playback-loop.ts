import type { BufferPolicy } from "./buffer-policy";
import type { EventEmitter } from "./event-emitter";
import type { MediaSourceController } from "./media-source-controller";
import type { PlaybackClient } from "./playback-client";
import { currentTimeMs } from "./player-snapshot";
import type { SegmentScheduler } from "./segment-scheduler";
import type { LoadedSession } from "./session-loader";
import { refreshPlaybackWindow } from "./session-loader";

type PlaybackLoopArgs = {
  video: { currentTime: number };
  playback: Pick<PlaybackClient, "position" | "prefetch" | "segments">;
  media: Pick<MediaSourceController, "bufferedRanges" | "trim">;
  scheduler: Pick<SegmentScheduler, "fill">;
  emitter: Pick<EventEmitter, "emit">;
  policy: BufferPolicy;
  session: () => LoadedSession | null;
  signal: () => AbortSignal;
  bufferedEndMs: () => number;
  error: (error: Error) => void;
};

export class PlaybackLoop {
  private fillTimer: ReturnType<typeof setInterval> | null = null;
  private manifestTimer: ReturnType<typeof setInterval> | null = null;
  private filling = false;
  private refreshing = false;

  constructor(private readonly args: PlaybackLoopArgs) {}

  start(): void {
    this.stop();
    this.fillTimer = setInterval(
      () => void this.fillOnce().catch((error) => this.args.error(error)),
      this.args.policy.pollIntervalMs,
    );
    this.manifestTimer = setInterval(
      () => this.requestManifestRefresh(),
      this.args.policy.manifestRefreshMs,
    );
  }

  stop(): void {
    if (this.fillTimer) clearInterval(this.fillTimer);
    if (this.manifestTimer) clearInterval(this.manifestTimer);
    this.fillTimer = null;
    this.manifestTimer = null;
  }

  async fillOnce(): Promise<void> {
    const session = this.args.session();
    if (!session || this.filling) return;
    this.filling = true;
    try {
      const currentMs = currentTimeMs(this.args.video);
      const goalMs = currentMs + this.args.policy.bufferGoalMs;
      await this.args.scheduler.fill(session.manifest, currentMs, goalMs, this.args.signal());
      await this.args.media.trim(currentMs, this.args.policy.backBufferMs);
      const bufferedEndMs = this.args.bufferedEndMs();
      this.args.emitter.emit({
        type: "buffer",
        currentTimeMs: currentMs,
        bufferedEndMs,
      });
      if (bufferedEndMs < goalMs) this.requestManifestRefresh();
    } finally {
      this.filling = false;
    }
  }

  private async refreshManifest(): Promise<void> {
    const session = this.args.session();
    if (!session || this.refreshing) return;
    this.refreshing = true;
    try {
      await refreshPlaybackWindow(
        this.args.playback,
        this.args.media,
        session,
        this.args.policy,
        currentTimeMs(this.args.video),
        this.args.signal(),
      );
    } finally {
      this.refreshing = false;
    }
  }

  private requestManifestRefresh(): void {
    void this.refreshManifest().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      this.args.error(
        error instanceof Error ? error : new Error("Playback manifest refresh failed"),
      );
    });
  }
}
