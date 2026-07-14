import { decodeStartMs } from "./decode-preroll";
import type { PlayerDeps } from "./player-deps";
import type { PlaybackRecovery } from "./player-recovery";
import {
  type LoadedSession,
  loadPlaybackSession,
  PlaybackWindowRecoveryError,
} from "./session-loader";
import type { TypeTypeMseConfig, TypeTypeMseQuality } from "./types";

type Args = {
  deps: PlayerSessionDeps;
  config: TypeTypeMseConfig;
  video: { currentTime: number };
  response: LoadedSession["response"];
  current: LoadedSession | null;
  quality: TypeTypeMseQuality | undefined;
  startTimeMs: number;
  signal: AbortSignal;
  recovery: PlaybackRecovery;
};

type PlayerSessionDeps = {
  playback: Pick<PlayerDeps["playback"], "create" | "position" | "prefetch" | "segments">;
  media: Pick<PlayerDeps["media"], "attach" | "bufferedRanges">;
  scheduler: Pick<PlayerDeps["scheduler"], "appendInit" | "fill" | "reset">;
  policy: PlayerDeps["policy"];
};

type TrackSelection = {
  videoItag: number;
  audioItag: number;
  audioTrackId: string | null;
};

export async function loadPlayerSession(args: Args): Promise<LoadedSession> {
  const selection = resolveSelection(args);
  try {
    return await loadSelectedSession(args, args.response, selection);
  } catch (error) {
    if (!(error instanceof PlaybackWindowRecoveryError)) throw error;
    return recoverInitialSession(args, selection, error);
  }
}

export function loadPlayerSessionOnce(args: Args): Promise<LoadedSession> {
  const selection = resolveSelection(args);
  return loadSelectedSession(args, args.response, selection);
}

function resolveSelection(args: Args): TrackSelection {
  return {
    videoItag: args.quality?.videoItag ?? args.current?.videoItag ?? args.config.videoItag,
    audioItag: args.quality?.audioItag ?? args.current?.audioItag ?? args.config.audioItag,
    audioTrackId:
      args.quality?.audioTrackId ?? args.current?.audioTrackId ?? args.config.audioTrackId,
  };
}

async function loadSelectedSession(
  args: Args,
  response: LoadedSession["response"],
  selection: TrackSelection,
): Promise<LoadedSession> {
  const session = await loadPlaybackSession({
    playback: args.deps.playback,
    media: args.deps.media,
    scheduler: args.deps.scheduler,
    video: args.video,
    response,
    videoItag: selection.videoItag,
    audioItag: selection.audioItag,
    audioTrackId: selection.audioTrackId,
    audioOnly: args.config.audioOnly === true,
    startTimeMs: args.startTimeMs,
    policy: args.deps.policy,
    signal: args.signal,
  });
  const fillStartMs = decodeStartMs(session.manifest, args.startTimeMs);
  await args.deps.scheduler.fill(
    session.manifest,
    fillStartMs,
    args.startTimeMs + args.deps.policy.bufferGoalMs,
    args.signal,
  );
  if (args.signal.aborted) throw new DOMException("Operation aborted", "AbortError");
  return session;
}

async function recoverInitialSession(
  args: Args,
  selection: TrackSelection,
  initialError: PlaybackWindowRecoveryError,
): Promise<LoadedSession> {
  let videoItag = selection.videoItag;
  let lastError: unknown = initialError;
  let recoveryError: PlaybackWindowRecoveryError | null = initialError;
  while (true) {
    if (recoveryError?.recoveryAction === "retry_fresh_session_lower_video_itag") {
      videoItag = args.recovery.nextLowerVideoItag(recoveryError, videoItag);
    }
    if (!args.recovery.takeAttempt(videoItag)) throw lastError;
    try {
      const response = await args.deps.playback.create(
        {
          videoId: args.config.videoId,
          videoItag,
          audioItag: selection.audioItag,
          audioTrackId: selection.audioTrackId,
          startTimeMs: args.startTimeMs,
          audioOnly: args.config.audioOnly === true,
        },
        args.signal,
      );
      const session = await loadSelectedSession(args, response, { ...selection, videoItag });
      return session;
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (error instanceof PlaybackWindowRecoveryError) recoveryError = error;
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
