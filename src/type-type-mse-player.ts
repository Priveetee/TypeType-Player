import { resolveBufferPolicy } from "./buffer-policy";
import { EventEmitter } from "./event-emitter";
import { HttpClient } from "./http-client";
import { MediaElementObserver } from "./media-element-observer";
import { MediaSourceController } from "./media-source-controller";
import { PlaybackClient } from "./playback-client";
import { PlaybackLoop } from "./playback-loop";
import { bufferedEndMs, createSnapshot, type TypeTypeMseSnapshot } from "./player-snapshot";
import { SeekController } from "./seek-controller";
import { SegmentScheduler } from "./segment-scheduler";
import { type LoadedSession, loadPlaybackSession } from "./session-loader";
import type {
  TypeTypeMseConfig,
  TypeTypeMseEventType,
  TypeTypeMseListener,
  TypeTypeMseState,
} from "./types";

export class TypeTypeMsePlayer {
  private readonly emitter = new EventEmitter();
  private readonly http: HttpClient;
  private readonly playback: PlaybackClient;
  private readonly mediaEvents: MediaElementObserver;
  private readonly media: MediaSourceController;
  private readonly scheduler: SegmentScheduler;
  private readonly loop: PlaybackLoop;
  private readonly seekController = new SeekController();
  private session: LoadedSession | null = null;
  private operation = new AbortController();
  private revision = 0;
  private destroyed = false;
  private state: TypeTypeMseState = "idle";

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly config: TypeTypeMseConfig,
  ) {
    this.http = new HttpClient(
      config.headers
        ? { endpoint: config.endpoint, headers: config.headers }
        : { endpoint: config.endpoint },
    );
    this.playback = new PlaybackClient(this.http);
    this.mediaEvents = new MediaElementObserver({
      video,
      state: (state) => this.setState(state),
      error: (error) => this.handleError(error),
    });
    this.mediaEvents.start();
    this.media = new MediaSourceController(video);
    this.scheduler = new SegmentScheduler(this.http, this.media, this.emitter);
    this.loop = new PlaybackLoop({
      video,
      http: this.http,
      media: this.media,
      scheduler: this.scheduler,
      emitter: this.emitter,
      policy: resolveBufferPolicy(config),
      session: () => this.session,
      signal: () => this.operation.signal,
      bufferedEndMs: () => bufferedEndMs(this.video),
      error: (error) => this.handleError(error),
    });
  }

  on(type: TypeTypeMseEventType, listener: TypeTypeMseListener): () => void {
    return this.emitter.on(type, listener);
  }

  async load(): Promise<void> {
    this.ensureAlive();
    const revision = this.nextRevision();
    const signal = this.operation.signal;
    this.setState("loading");
    const startTimeMs = Math.max(0, Math.round(this.config.startTimeMs ?? 0));
    const response = await this.playback.create(
      {
        videoId: this.config.videoId,
        videoItag: this.config.videoItag,
        audioItag: this.config.audioItag,
        audioTrackId: this.config.audioTrackId,
        startTimeMs,
      },
      signal,
    );
    await this.switchSession(response, startTimeMs, revision, signal);
  }

  async play(): Promise<void> {
    this.ensureAlive();
    await this.video.play();
    this.setState("playing");
  }

  pause(): void {
    this.video.pause();
    this.setState("ready");
  }

  async seek(positionMs: number): Promise<void> {
    this.operation.abort();
    return this.seekController.seek(positionMs, (targetMs) => this.performSeek(targetMs));
  }

  snapshot(): TypeTypeMseSnapshot {
    return createSnapshot(this.video, this.state, this.session, bufferedEndMs(this.video));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.operation.abort();
    this.seekController.reset();
    this.loop.stop();
    this.mediaEvents.stop();
    this.media.detach();
    this.emitter.clear();
    this.state = "destroyed";
  }

  private async performSeek(positionMs: number): Promise<void> {
    this.ensureAlive();
    const current = this.session;
    if (!current) throw new Error("Player is not loaded");
    const revision = this.nextRevision();
    const signal = this.operation.signal;
    const targetMs = Math.max(0, Math.round(positionMs));
    this.loop.stop();
    this.setState("seeking");
    this.emitter.emit({ type: "seek", positionMs: targetMs });
    const response = await this.playback.seek(current.response.sessionId, targetMs, signal);
    await this.switchSession(response, targetMs, revision, signal);
  }

  private async switchSession(
    response: LoadedSession["response"],
    startTimeMs: number,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> {
    const session = await loadPlaybackSession({
      http: this.http,
      playback: this.playback,
      media: this.media,
      scheduler: this.scheduler,
      video: this.video,
      response,
      startTimeMs,
      signal,
    });
    if (!this.isCurrent(revision)) return;
    this.session = session;
    await this.loop.fillOnce();
    this.loop.start();
    this.emitter.emit({
      type: "manifest",
      generation: response.generation,
      segmentCount: session.manifest.audio.segments.length + session.manifest.video.segments.length,
    });
    this.setState("ready");
  }

  private setState(state: TypeTypeMseState): void {
    if (this.state === state) return;
    this.state = state;
    this.emitter.emit({ type: "state", state });
  }

  private handleError(error: Error): void {
    if (this.destroyed || error.name === "AbortError") return;
    this.setState("error");
    this.emitter.emit({ type: "error", error });
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("Player is destroyed");
  }

  private nextRevision(): number {
    this.operation.abort();
    this.operation = new AbortController();
    this.revision += 1;
    return this.revision;
  }

  private isCurrent(revision: number): boolean {
    return !this.destroyed && this.revision === revision;
  }
}
