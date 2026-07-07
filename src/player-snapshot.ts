import type { LoadedSession } from "./session-loader";
import type { TypeTypeMseState } from "./types";

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
  bufferedEndMs: number,
): TypeTypeMseSnapshot {
  return {
    state,
    sessionId: session?.response.sessionId ?? null,
    generation: session?.response.generation ?? null,
    currentTimeMs: Math.max(0, Math.round(video.currentTime * 1000)),
    bufferedEndMs,
  };
}
