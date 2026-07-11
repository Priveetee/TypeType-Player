import { expect, test } from "bun:test";
import type { PlaybackManifest } from "../src/manifest";
import { PlaybackLoop } from "../src/playback-loop";
import type { PlaybackWindow, PlaybackWindowRequest } from "../src/playback-window";
import type { LoadedSession } from "../src/session-loader";

const manifest: PlaybackManifest = {
  durationMs: 120_000,
  endOfStream: false,
  audio: { kind: "audio", mime: "audio/mp4", initUrl: "/audio/init", segments: [] },
  video: { kind: "video", mime: "video/mp4", initUrl: "/video/init", segments: [] },
};

function window(request: PlaybackWindowRequest): PlaybackWindow {
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
    bufferedEdgeMs: 30_000,
    manifest,
  };
}

test("refreshes rapidly only while the playback buffer is below goal", async () => {
  let bufferedEndMs = 5_000;
  let positionCalls = 0;
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
  };
  const loop = new PlaybackLoop({
    video: { currentTime: 0 },
    playback: {
      position: async (_sessionId, request) => {
        positionCalls += 1;
        return window(request);
      },
      prefetch: async (_sessionId, request) => window(request),
      segments: async (_sessionId, request) => window(request),
    },
    media: { bufferedRanges: () => [], endOfStream: () => false, trim: async () => undefined },
    scheduler: { fill: async () => undefined },
    emitter: { emit: () => undefined },
    policy: {
      bufferGoalMs: 30_000,
      backBufferMs: 30_000,
      pollIntervalMs: 500,
      manifestRefreshMs: 8_000,
      manifestPollLimit: 2,
      segmentPollLimit: 2,
    },
    session: () => session,
    signal: () => new AbortController().signal,
    bufferedEndMs: () => bufferedEndMs,
    error: (error) => {
      throw error;
    },
  });

  await loop.fillOnce();
  await Bun.sleep(0);
  expect(positionCalls).toBe(1);

  bufferedEndMs = 30_000;
  await loop.fillOnce();
  await Bun.sleep(0);
  expect(positionCalls).toBe(1);
});

test("closes the media source after appending the final window", async () => {
  let ended = 0;
  const session: LoadedSession = {
    response: {
      sessionId: "session",
      videoId: "video",
      generation: 0,
      ready: true,
      retryAfterMs: null,
    },
    manifest: { ...manifest, endOfStream: true },
    videoItag: 299,
    audioItag: 140,
    audioTrackId: null,
  };
  const loop = new PlaybackLoop({
    video: { currentTime: 119 },
    playback: {
      position: async (_sessionId, request) => window(request),
      prefetch: async (_sessionId, request) => window(request),
      segments: async (_sessionId, request) => window(request),
    },
    media: {
      bufferedRanges: () => [],
      endOfStream: () => {
        ended += 1;
        return true;
      },
      trim: async () => undefined,
    },
    scheduler: { fill: async () => undefined },
    emitter: { emit: () => undefined },
    policy: {
      bufferGoalMs: 30_000,
      backBufferMs: 30_000,
      pollIntervalMs: 500,
      manifestRefreshMs: 8_000,
      manifestPollLimit: 2,
      segmentPollLimit: 2,
    },
    session: () => session,
    signal: () => new AbortController().signal,
    bufferedEndMs: () => 120_000,
    error: (error) => {
      throw error;
    },
  });

  await loop.fillOnce();

  expect(ended).toBe(1);
});
