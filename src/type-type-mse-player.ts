import { decodeStartMs, runDecodePreroll } from "./decode-preroll";
import { EventEmitter } from "./event-emitter";
import { LiveEdgeFollower } from "./live-edge-follower";
import { PlaybackIntent } from "./playback-intent";
import type { PlaybackLoopFailureContext } from "./playback-loop";
import { createPlayerDeps, type PlayerDeps } from "./player-deps";
import { emitManifest, emitQuality } from "./player-events";
import { ensurePlayerAlive, PlayerOperation } from "./player-operation";
import { PlaybackRecovery, recoverPlaybackSession } from "./player-recovery";
import { loadPlayerSession, loadPlayerSessionOnce } from "./player-session-loader";
import { createSnapshot, currentTimeMs, type TypeTypeMseSnapshot } from "./player-snapshot";
import { PlayerState } from "./player-state";
import { SeekController } from "./seek-controller";
import { type LoadedSession, PlaybackWindowRecoveryError } from "./session-loader";
import { shouldApplySessionPosition } from "./session-position";
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
  private readonly playbackRecovery = new PlaybackRecovery();
  private readonly liveEdgeFollower: LiveEdgeFollower;
  private session: LoadedSession | null = null;
  private pendingPrerollTargetMs: number | null = null;
  private loadTask: Promise<void> | null = null;
  private liveEdgeCatchUpTask: Promise<void> | null = null;
  private sessionTransition: Promise<void> = Promise.resolve();
  private audioOnly: boolean;
  private recoveryPositionMs: number;
  private destroyed = false;

  /** Creates a player without starting network or media operations. */ constructor(
    private readonly video: HTMLVideoElement,
    private readonly config: TypeTypeMseConfig,
  ) {
    this.video.crossOrigin = "anonymous";
    this.video.playsInline = true;
    this.audioOnly = config.audioOnly === true;
    this.recoveryPositionMs = Math.max(0, Math.round(config.startTimeMs ?? 0));
    this.liveEdgeFollower = new LiveEdgeFollower(config.isLive === true);
    this.deps = createPlayerDeps({
      video,
      config,
      emitter: this.emitter,
      session: () => this.session,
      signal: () => this.operation.signal,
      state: (state) => this.playerState.set(state),
      error: (error) => this.reportPlaybackFailure(error),
      progress: (positionMs) => {
        this.rememberRecoveryPosition(positionMs);
        this.playbackRecovery.observeProgress(positionMs);
        this.followLiveEdge(positionMs);
      },
      loopError: (error, context) => this.handlePlaybackLoopError(error, context),
    });
    this.deps.mediaEvents.start();
  }
  /** Subscribes to player events. */ on(
    type: TypeTypeMseEventType,
    listener: TypeTypeMseListener,
  ): () => void {
    return this.emitter.on(type, listener);
  }

  /** Creates the initial playback session and fills the first media window. */ load(): Promise<void> {
    ensurePlayerAlive(this.destroyed);
    const task = this.loadInitialSession().catch((error: unknown) => {
      if (!isAbortError(error)) this.reportPlaybackFailure(asError(error));
      throw error;
    });
    this.loadTask = task;
    const clearTask = () => {
      if (this.loadTask === task) this.loadTask = null;
    };
    void task.then(clearTask, clearTask);
    return task;
  }

  /** Creates and attaches the initial SABR session. */
  private async loadInitialSession(): Promise<void> {
    this.resetPlaybackRecovery();
    const revision = this.operation.next();
    const signal = this.operation.signal;
    this.playerState.set("loading");
    const startTimeMs = Math.max(0, Math.round(this.config.startTimeMs ?? 0));
    this.recoveryPositionMs = startTimeMs;
    const response = await this.deps.playback.create(
      {
        videoId: this.config.videoId,
        videoItag: this.config.videoItag,
        audioItag: this.config.audioItag,
        audioTrackId: this.config.audioTrackId,
        startTimeMs,
        audioOnly: this.audioOnly,
        ...(this.config.isLive ? { isLive: true } : {}),
      },
      signal,
    );
    await this.switchSession(response, startTimeMs, revision, signal);
  }
  /** Starts or resumes playback after loading. */ async play(): Promise<void> {
    ensurePlayerAlive(this.destroyed);
    this.playbackIntent.play();
    if (!this.session || this.playerState.value === "loading") return;
    if (this.pendingPrerollTargetMs !== null) {
      const targetMs = this.pendingPrerollTargetMs;
      await runDecodePreroll(this.video, targetMs, true, this.operation.signal);
      this.pendingPrerollTargetMs = null;
      this.playerState.set("playing");
      return;
    }
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
    this.liveEdgeFollower.observeUserSeek(targetMs, this.session?.manifest.live);
    this.recoveryPositionMs = targetMs;
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
    if (this.audioOnly === audioOnly && this.session?.audioOnly === audioOnly) return;
    const previous = this.audioOnly;
    this.audioOnly = audioOnly;
    if (!this.session && this.loadTask) await this.loadTask;
    ensurePlayerAlive(this.destroyed);
    if (this.audioOnly !== audioOnly) return;
    if (this.session?.audioOnly === audioOnly) {
      return;
    }
    this.playbackIntent.capture(this.video.paused, this.playerState.value === "seeking");
    const targetMs = currentTimeMs(this.video);
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
    this.pendingPrerollTargetMs = null;
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
    this.resetPlaybackRecovery();
    const revision = this.operation.next();
    const signal = this.operation.signal;
    const targetMs = Math.max(0, Math.round(positionMs));
    if (!quality) this.deps.loop.stop();
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
        true,
      );
      if (quality) emitQuality(this.emitter, session);
    } catch (error) {
      if (!this.destroyed && this.operation.isCurrent(revision) && this.session === current) {
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
    finalizePausedSeek = false,
    allowWindowRecovery = true,
  ): Promise<LoadedSession> {
    return this.enqueueSessionTransition(() =>
      this.activateSession(
        response,
        startTimeMs,
        revision,
        signal,
        quality,
        audioOnly,
        finalizePausedSeek,
        allowWindowRecovery,
      ),
    );
  }

  /** Quiesces old media work before attaching and starting a replacement session. */
  private async activateSession(
    response: LoadedSession["response"],
    startTimeMs: number,
    revision: number,
    signal: AbortSignal,
    quality?: TypeTypeMseQuality,
    audioOnly = this.audioOnly,
    finalizePausedSeek = false,
    allowWindowRecovery = true,
  ): Promise<LoadedSession> {
    const quiesce = async () => {
      await this.deps.loop.quiesce();
      this.operation.ensureCurrent(this.destroyed, revision);
    };
    if (!quality) await quiesce();
    const load = allowWindowRecovery ? loadPlayerSession : loadPlayerSessionOnce;
    const session = await load({
      deps: this.deps,
      config: { ...this.config, audioOnly },
      video: this.video,
      response,
      current: this.session,
      quality,
      startTimeMs,
      signal,
      recovery: this.playbackRecovery,
      ...(quality ? { beforeAttach: quiesce } : {}),
    });
    this.operation.ensureCurrent(this.destroyed, revision);
    const resolvedStartTimeMs =
      session.response.startTimeMs ?? session.manifest.startTimeMs ?? startTimeMs;
    this.recoveryPositionMs = resolvedStartTimeMs;
    const startMs = decodeStartMs(session.manifest, resolvedStartTimeMs);
    if (shouldApplySessionPosition(resolvedStartTimeMs, finalizePausedSeek)) {
      this.video.currentTime = startMs / 1000;
    }
    this.session = session;
    await this.deps.loop.fillOnce();
    this.operation.ensureCurrent(this.destroyed, revision);
    if (resolvedStartTimeMs > startMs) {
      if (this.playbackIntent.shouldResume) {
        await runDecodePreroll(this.video, resolvedStartTimeMs, true, signal);
        this.pendingPrerollTargetMs = null;
      } else {
        if (finalizePausedSeek) {
          await runDecodePreroll(this.video, resolvedStartTimeMs, false, signal, true);
          this.pendingPrerollTargetMs = null;
        } else {
          this.pendingPrerollTargetMs = resolvedStartTimeMs;
        }
      }
    } else if (this.playbackIntent.shouldResume) {
      this.pendingPrerollTargetMs = null;
      if (resolvedStartTimeMs > 0) {
        await runDecodePreroll(this.video, resolvedStartTimeMs, false, signal, true);
      }
      await this.video.play();
    } else if (finalizePausedSeek && resolvedStartTimeMs > 0) {
      await runDecodePreroll(this.video, resolvedStartTimeMs, false, signal, true);
      this.pendingPrerollTargetMs = null;
    } else {
      this.pendingPrerollTargetMs = null;
    }
    this.operation.ensureCurrent(this.destroyed, revision);
    this.playbackRecovery.complete(currentTimeMs(this.video));
    this.liveEdgeFollower.initialize(currentTimeMs(this.video), session.manifest.live);
    this.deps.loop.start();
    emitManifest(this.emitter, session.response, session);
    this.playerState.set(this.video.paused ? "ready" : "playing");
    return session;
  }

  /** Recovers terminal playback windows within the bounded fresh-session budget. */
  private handlePlaybackLoopError(error: Error, context: PlaybackLoopFailureContext): void {
    if (this.destroyed || context.signal.aborted) return;
    const current = this.session;
    const sessionId = context.sessionId;
    if (!current || sessionId === null || sessionId !== current.response.sessionId) return;
    if (!(error instanceof PlaybackWindowRecoveryError)) {
      this.reportPlaybackFailure(error);
      return;
    }
    this.rememberRecoveryPosition(currentTimeMs(this.video));
    const positionMs = this.recoveryPositionMs;
    const decision = this.playbackRecovery.begin(sessionId);
    if (decision === "ignore") return;
    if (decision === "exhausted") {
      this.reportPlaybackFailure(error);
      return;
    }
    const revision = this.operation.next();
    const signal = this.operation.signal;
    this.deps.loop.stop();
    this.playbackIntent.capture(this.video.paused, this.playerState.value === "seeking");
    this.playerState.set("buffering");
    void recoverPlaybackSession({
      recovery: this.playbackRecovery,
      current,
      error,
      videoId: this.config.videoId,
      isLive: this.config.isLive === true,
      startTimeMs: positionMs,
      signal,
      create: (request, recoverySignal) => this.deps.playback.create(request, recoverySignal),
      ensureCurrent: () => this.operation.ensureCurrent(this.destroyed, revision),
      switchSession: (response, quality) =>
        this.switchSession(
          response,
          positionMs,
          revision,
          signal,
          quality,
          current.audioOnly,
          false,
          false,
        ),
    })
      .then((session) => {
        if (this.operation.isCurrent(revision) && session.videoItag !== current.videoItag) {
          emitQuality(this.emitter, session);
        }
      })
      .catch((recoveryError: unknown) => {
        if (isAbortError(recoveryError)) return;
        if (!this.destroyed && this.operation.isCurrent(revision)) {
          this.reportPlaybackFailure(asError(recoveryError));
        }
      })
      .finally(() => {
        this.playbackRecovery.finish(sessionId);
      });
  }

  /** Starts a new recovery episode for an explicit user operation. */
  private resetPlaybackRecovery(): void {
    this.playbackRecovery.reset();
  }

  /** Publishes one final playback failure and aborts pending media work. */
  private reportPlaybackFailure(error: Error): void {
    if (this.destroyed) return;
    this.rememberRecoveryPosition(currentTimeMs(this.video));
    this.playbackRecovery.reportOnce(error, (failure) => {
      this.operation.abort();
      this.deps.loop.stop();
      this.playerState.fail(failure, this.recoveryPositionMs);
    });
  }

  /** Keeps the last usable media position across source teardown. */
  private rememberRecoveryPosition(positionMs: number): void {
    if (Number.isFinite(positionMs) && positionMs > 0) {
      this.recoveryPositionMs = Math.round(positionMs);
    }
  }

  /** Keeps active live playback within the configured edge latency. */
  private followLiveEdge(positionMs: number): void {
    if (this.destroyed || this.liveEdgeCatchUpTask) return;
    const targetMs = this.liveEdgeFollower.nextTarget({
      positionMs,
      live: this.session?.manifest.live,
      paused: this.video.paused,
      busy: this.playerState.value === "loading" || this.playerState.value === "seeking",
      nowMs: Date.now(),
    });
    if (targetMs === null) return;
    this.playbackIntent.capture(this.video.paused, this.playerState.value === "seeking");
    const task = this.seekController
      .seek(
        targetMs,
        `live-edge:${targetMs}`,
        (target) => this.performSeek(target),
        () => this.operation.abort(),
      )
      .catch((error: unknown) => {
        if (!isAbortError(error)) this.rememberRecoveryPosition(currentTimeMs(this.video));
      })
      .finally(() => {
        if (this.liveEdgeCatchUpTask === task) this.liveEdgeCatchUpTask = null;
      });
    this.liveEdgeCatchUpTask = task;
  }

  /** Serializes MediaSource ownership transitions. */
  private enqueueSessionTransition<T>(work: () => Promise<T>): Promise<T> {
    const result = this.sessionTransition.then(work, work);
    this.sessionTransition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("SABR playback recovery failed");
}
