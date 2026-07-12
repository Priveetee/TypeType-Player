import { decodeStartMs, runDecodePreroll } from "./decode-preroll";
import { EventEmitter } from "./event-emitter";
import { PlaybackIntent } from "./playback-intent";
import { createPlayerDeps, type PlayerDeps } from "./player-deps";
import { emitManifest, emitQuality } from "./player-events";
import { ensurePlayerAlive, PlayerOperation } from "./player-operation";
import { loadPlayerSession } from "./player-session-loader";
import { createSnapshot, currentTimeMs, type TypeTypeMseSnapshot } from "./player-snapshot";
import { PlayerState } from "./player-state";
import { SeekController } from "./seek-controller";
import type { LoadedSession } from "./session-loader";
import type {
  TypeTypeMseConfig,
  TypeTypeMseEventType,
  TypeTypeMseListener,
  TypeTypeMseQuality,
} from "./types";

/** Drives TypeType SABR playback through Media Source Extensions on an HTML video element. */ export class TypeTypeMsePlayer {
  private readonly emitter = new EventEmitter();
  private readonly deps: PlayerDeps;
  private readonly playerState = new PlayerState(this.emitter);
  private readonly playbackIntent = new PlaybackIntent();
  private readonly seekController = new SeekController();
  private readonly operation = new PlayerOperation();
  private session: LoadedSession | null = null;
  private audioOnly: boolean;
  private destroyed = false;

  /** Creates a player without starting network or media operations. */ constructor(
    private readonly video: HTMLVideoElement,
    private readonly config: TypeTypeMseConfig,
  ) {
    this.audioOnly = config.audioOnly === true;
    this.deps = createPlayerDeps({
      video,
      config,
      emitter: this.emitter,
      session: () => this.session,
      signal: () => this.operation.signal,
      state: (state) => this.playerState.set(state),
      error: (error) => {
        if (!this.destroyed) this.playerState.fail(error);
      },
    });
    this.deps.mediaEvents.start();
  }
  /** Subscribes to player events. */ on(
    type: TypeTypeMseEventType,
    listener: TypeTypeMseListener,
  ): () => void {
    return this.emitter.on(type, listener);
  }

  /** Creates the initial playback session and fills the first media window. */ async load(): Promise<void> {
    ensurePlayerAlive(this.destroyed);
    const revision = this.operation.next();
    const signal = this.operation.signal;
    this.playerState.set("loading");
    const startTimeMs = Math.max(0, Math.round(this.config.startTimeMs ?? 0));
    const response = await this.deps.playback.create(
      {
        videoId: this.config.videoId,
        videoItag: this.config.videoItag,
        audioItag: this.config.audioItag,
        audioTrackId: this.config.audioTrackId,
        startTimeMs,
        audioOnly: this.audioOnly,
      },
      signal,
    );
    await this.switchSession(response, startTimeMs, revision, signal);
  }
  /** Starts or resumes playback after loading. */ async play(): Promise<void> {
    ensurePlayerAlive(this.destroyed);
    this.playbackIntent.play();
    if (!this.session || this.playerState.value === "loading") return;
    await this.video.play();
    this.playerState.set("playing");
  }

  /** Pauses playback while preserving the current session and buffer. */ pause(): void {
    this.playbackIntent.pause();
    this.video.pause();
    this.playerState.set("ready");
  }
  /** Seeks to a millisecond position without replacing the media element. */
  async seek(positionMs: number): Promise<void> {
    this.playbackIntent.capture(this.video.paused, this.playerState.value === "seeking");
    const targetMs = Math.max(0, Math.round(positionMs));
    return this.seekController.seek(
      targetMs,
      `seek:${targetMs}`,
      (target) => this.performSeek(target),
      () => this.operation.abort(),
    );
  }

  /** Switches formats at the current position without changing playback intent. */
  async setQuality(quality: TypeTypeMseQuality): Promise<void> {
    this.playbackIntent.capture(this.video.paused, this.playerState.value === "seeking");
    const targetMs = currentTimeMs(this.video);
    const key = `quality:${targetMs}:${quality.videoItag}:${quality.audioItag}:${quality.audioTrackId ?? ""}`;
    return this.seekController.seek(
      targetMs,
      key,
      (target) => this.performSeek(target, quality),
      () => this.operation.abort(),
    );
  }

  /** Switches between audio-only and audiovisual playback on the active session. */
  async setAudioOnly(audioOnly: boolean): Promise<void> {
    ensurePlayerAlive(this.destroyed);
    if (this.audioOnly === audioOnly) return;
    this.playbackIntent.capture(this.video.paused, this.playerState.value === "seeking");
    const previous = this.audioOnly;
    const targetMs = currentTimeMs(this.video);
    this.audioOnly = audioOnly;
    try {
      await this.seekController.seek(
        targetMs,
        `mode:${targetMs}:${audioOnly}`,
        (target) => this.performSeek(target, undefined, audioOnly),
        () => this.operation.abort(),
      );
    } catch (error) {
      if (this.audioOnly === audioOnly) this.audioOnly = previous;
      throw error;
    }
  }

  /** Returns current state, timing, buffer, and session diagnostics. */
  snapshot(): TypeTypeMseSnapshot {
    return createSnapshot(this.video, this.playerState.value, this.session);
  }

  /** Aborts pending work and releases all media and event resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.operation.abort();
    this.seekController.reset();
    this.deps.destroy();
    this.emitter.clear();
    this.playerState.destroy();
  }

  /** Executes the latest coalesced seek or quality operation. */
  private async performSeek(
    positionMs: number,
    quality?: TypeTypeMseQuality,
    audioOnly = this.audioOnly,
  ): Promise<void> {
    ensurePlayerAlive(this.destroyed);
    const current = this.session;
    if (!current) throw new Error("Player is not loaded");
    const revision = this.operation.next();
    const signal = this.operation.signal;
    const targetMs = Math.max(0, Math.round(positionMs));
    this.deps.loop.stop();
    this.playerState.set("seeking");
    this.emitter.emit({ type: "seek", positionMs: targetMs });
    try {
      const response = await this.deps.playback.seek(
        current.response.sessionId,
        targetMs,
        { ...quality, audioOnly },
        signal,
      );
      const session = await this.switchSession(
        response,
        targetMs,
        revision,
        signal,
        quality,
        audioOnly,
      );
      if (quality) emitQuality(this.emitter, session);
    } catch (error) {
      if (!this.destroyed && this.session === current) {
        this.deps.loop.start();
        this.playerState.set(this.video.paused ? "ready" : "playing");
      }
      throw error;
    }
  }

  /** Loads and activates a replacement backend playback session. */
  private async switchSession(
    response: LoadedSession["response"],
    startTimeMs: number,
    revision: number,
    signal: AbortSignal,
    quality?: TypeTypeMseQuality,
    audioOnly = this.audioOnly,
  ): Promise<LoadedSession> {
    const session = await loadPlayerSession({
      deps: this.deps,
      config: { ...this.config, audioOnly },
      video: this.video,
      response,
      current: this.session,
      quality,
      startTimeMs,
      signal,
    });
    this.operation.ensureCurrent(this.destroyed, revision);
    const startMs = decodeStartMs(session.manifest, startTimeMs);
    if (startTimeMs > 0) this.video.currentTime = startMs / 1000;
    this.session = session;
    await this.deps.loop.fillOnce();
    if (startTimeMs > startMs) {
      await runDecodePreroll(this.video, startTimeMs, this.playbackIntent.shouldResume, signal);
    } else if (this.playbackIntent.shouldResume) {
      await this.video.play();
    }
    this.deps.loop.start();
    emitManifest(this.emitter, session.response, session);
    this.playerState.set(this.video.paused ? "ready" : "playing");
    return session;
  }
}
