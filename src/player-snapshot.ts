import { bufferedEndAtCurrentTime } from "./media-buffer";
import type { LoadedSession } from "./session-loader";
import type { TypeTypeMseState } from "./types";

/** Immutable diagnostic view of the active media element and playback session. */
export type TypeTypeMseSnapshot = {
  state: TypeTypeMseState;
  sessionId: string | null;
  generation: number | null;
  currentTimeMs: number;
  bufferedEndMs: number;
};

export function createSnapshot(
  video: HTMLVideoElement,
  state: TypeTypeMseState,
  session: LoadedSession | null,
): TypeTypeMseSnapshot {
  return {
    state,
    sessionId: session?.response.sessionId ?? null,
    generation: session?.response.generation ?? null,
    currentTimeMs: Math.max(0, Math.round(video.currentTime * 1000)),
    bufferedEndMs: bufferedEndMs(video),
  };
}

export function bufferedEndMs(video: HTMLVideoElement): number {
  return bufferedEndAtCurrentTime(video);
}

export function currentTimeMs(video: { currentTime: number }): number {
  return Math.max(0, Math.round(video.currentTime * 1000));
}
