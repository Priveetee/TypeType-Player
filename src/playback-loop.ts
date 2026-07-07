import type { BufferPolicy } from "./buffer-policy";
import type { EventEmitter } from "./event-emitter";
import type { HttpClient } from "./http-client";
import type { MediaSourceController } from "./media-source-controller";
import type { SegmentScheduler } from "./segment-scheduler";
import type { LoadedSession } from "./session-loader";
import { refreshSessionManifest } from "./session-loader";

type PlaybackLoopArgs = {
  video: HTMLVideoElement;
  http: HttpClient;
  media: MediaSourceController;
  scheduler: SegmentScheduler;
  emitter: EventEmitter;
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

  constructor(private readonly args: PlaybackLoopArgs) {}

  start(): void {
    this.stop();
    this.fillTimer = setInterval(
      () => void this.fillOnce().catch((error) => this.args.error(error)),
      this.args.policy.pollIntervalMs,
    );
    this.manifestTimer = setInterval(
      () => void this.refreshManifest().catch((error) => this.args.error(error)),
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
      const currentTimeMs = Math.max(0, Math.round(this.args.video.currentTime * 1000));
      const goalMs = currentTimeMs + this.args.policy.bufferGoalMs;
      await this.args.scheduler.fill(session.manifest, currentTimeMs, goalMs, this.args.signal());
      await this.args.media.trim(currentTimeMs, this.args.policy.backBufferMs);
      this.args.emitter.emit({
        type: "buffer",
        currentTimeMs,
        bufferedEndMs: this.args.bufferedEndMs(),
      });
    } finally {
      this.filling = false;
    }
  }

  private async refreshManifest(): Promise<void> {
    const session = this.args.session();
    if (!session) return;
    await refreshSessionManifest(this.args.http, session, this.args.signal());
  }
}
