import { expect, test } from "bun:test";
import type { PlaybackManifest } from "../src/manifest";
import { PlaybackLoop } from "../src/playback-loop";
import type { PlaybackWindow, PlaybackWindowRequest } from "../src/playback-window";
import type { LoadedSession } from "../src/session-loader";

const manifest: PlaybackManifest = {
  durationMs: 0,
  endOfStream: false,
  live: {
    active: true,
    postLiveDvr: false,
    headSequence: 100,
    headTimeMs: 200_000,
    seekableStartMs: 0,
    seekableEndMs: 200_000,
    atLiveEdge: true,
    targetLatencyMs: 8_000,
  },
  audio: { kind: "audio", mime: "audio/mp4", initUrl: "/audio/init", segments: [] },
  video: { kind: "video", mime: "video/mp4", initUrl: "/video/init", segments: [] },
};

function playbackWindow(request: PlaybackWindowRequest): PlaybackWindow {
  return {
    sessionId: "session",
    generation: request.generation,
    ready: true,
    retryAfterMs: null,
    terminalError: null,
    recoveryAction: null,
    retryVideoItags: [],
    status: "ready",
    blockedBy: null,
    bufferedEdgeMs: 20_000,
    manifest,
  };
}

function createLoop(video: { currentTime: number; paused: boolean; readyState: number }): {
  loop: PlaybackLoop;
  positionCalls: () => number;
  failures: Error[];
} {
  let calls = 0;
  const failures: Error[] = [];
  const session: LoadedSession = {
    response: {
      sessionId: "session",
      videoId: "video",
      generation: 0,
      ready: true,
      retryAfterMs: null,
    },
    manifest,
    videoItag: 299,
    audioItag: 140,
    audioTrackId: null,
    audioOnly: false,
  };
  const loop = new PlaybackLoop({
    video,
    playback: {
      position: async (_sessionId, request) => {
        calls += 1;
        return playbackWindow(request);
      },
      prefetch: async (_sessionId, request) => playbackWindow(request),
      segments: async (_sessionId, request) => playbackWindow(request),
    },
    media: { bufferedRanges: () => [], endOfStream: () => false, trim: async () => undefined },
    scheduler: { fill: async () => undefined },
    emitter: { emit: () => undefined },
    policy: {
      bufferGoalMs: 8_000,
      backBufferMs: 30_000,
      pollIntervalMs: 1_000,
      manifestRefreshMs: 1,
      manifestPollLimit: 2,
      segmentPollLimit: 2,
    },
    session: () => session,
    signal: () => new AbortController().signal,
    bufferedEndMs: () => 20_000,
    error: (error) => failures.push(error),
  });
  return { loop, positionCalls: () => calls, failures };
}

test("refreshes a stalled active live despite its reported buffer", async () => {
  const { loop, positionCalls, failures } = createLoop({
    currentTime: 10,
    paused: false,
    readyState: 2,
  });

  loop.start();
  await Bun.sleep(10);
  await loop.quiesce();

  expect(positionCalls()).toBeGreaterThan(0);
  expect(failures).toHaveLength(0);
});

test("does not refresh a paused live with enough reported buffer", async () => {
  const { loop, positionCalls, failures } = createLoop({
    currentTime: 10,
    paused: true,
    readyState: 2,
  });

  loop.start();
  await Bun.sleep(10);
  await loop.quiesce();

  expect(positionCalls()).toBe(0);
  expect(failures).toHaveLength(0);
});
