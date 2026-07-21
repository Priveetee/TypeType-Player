import { expect, test } from "bun:test";
import type { PlaybackManifest } from "../src/manifest";
import type { PlaybackResponse } from "../src/playback-client";
import type { PlaybackWindow, PlaybackWindowRequest } from "../src/playback-window";
import { PlaybackRecovery } from "../src/player-recovery";
import { loadPlayerSession, loadPlayerSessionOnce } from "../src/player-session-loader";

Object.defineProperty(globalThis, "MediaSource", {
  value: {
    isTypeSupported(mime: string): boolean {
      return mime.length > 0;
    },
  },
  configurable: true,
});

const manifest: PlaybackManifest = {
  durationMs: 120_000,
  endOfStream: false,
  audio: {
    kind: "audio",
    mime: 'audio/mp4; codecs="mp4a.40.2"',
    initUrl: "/audio/init",
    segments: [{ url: "/audio/6", startMs: 50_000, durationMs: 20_000 }],
  },
  video: {
    kind: "video",
    mime: 'video/mp4; codecs="avc1.640028"',
    initUrl: "/video/init",
    segments: [{ url: "/video/12", startMs: 59_000, durationMs: 11_000 }],
  },
};

function response(sessionId: string, videoId = "V_YKnVyUJgQ"): PlaybackResponse {
  return { sessionId, videoId, generation: 1, ready: false, retryAfterMs: null };
}

test("uses the server-resolved live start for the first window and buffer fill", async () => {
  const requestedPositions: number[] = [];
  const requestedSelections: Array<[number, number, string | null]> = [];
  const filledWindows: Array<[number, number]> = [];
  const live = {
    active: true,
    postLiveDvr: false,
    headSequence: 12,
    headTimeMs: 72_000,
    seekableStartMs: 0,
    seekableEndMs: 72_000,
    atLiveEdge: true,
    targetLatencyMs: 10_000,
  };
  const session = await loadPlayerSession({
    deps: {
      playback: {
        create: async () => response("unused"),
        position: async (sessionId, request) => {
          requestedPositions.push(request.playerTimeMs);
          requestedSelections.push([request.videoItag, request.audioItag, request.audioTrackId]);
          return { ...window(sessionId, request.generation, false), startTimeMs: 60_000, live };
        },
        prefetch: async (sessionId, request) => ({
          ...window(sessionId, request.generation, true),
          startTimeMs: 60_000,
          live,
          manifest: { ...manifest, startTimeMs: 60_000, live },
        }),
        segments: async (sessionId, request) => ({
          ...window(sessionId, request.generation, true),
          startTimeMs: 60_000,
          live,
          manifest: { ...manifest, startTimeMs: 60_000, live },
        }),
      },
      media: { attach: async () => undefined, bufferedRanges: () => [] },
      scheduler: {
        reset: () => undefined,
        appendInit: async () => undefined,
        fill: async (_manifest, startMs, endMs) => filledWindows.push([startMs, endMs]),
      },
      policy: {
        bufferGoalMs: 30_000,
        backBufferMs: 30_000,
        pollIntervalMs: 500,
        manifestRefreshMs: 8_000,
        manifestPollLimit: 2,
        segmentPollLimit: 2,
      },
    },
    config: {
      endpoint: "https://beta.typetype.video/api",
      videoId: "live-video",
      videoItag: 137,
      audioItag: 140,
      audioTrackId: null,
      isLive: true,
    },
    video: { currentTime: 0 },
    response: {
      ...response("live-session", "live-video"),
      videoItag: 248,
      audioItag: 251,
      audioTrackId: "fr-FR.4",
      startTimeMs: 60_000,
      live,
    },
    current: null,
    quality: undefined,
    startTimeMs: 0,
    signal: new AbortController().signal,
    recovery: new PlaybackRecovery(),
  });

  expect(requestedPositions).toEqual([60_000]);
  expect(requestedSelections).toEqual([[248, 251, "fr-FR.4"]]);
  expect(filledWindows).toEqual([[59_000, 90_000]]);
  expect(session.response.startTimeMs).toBe(60_000);
  expect(session.manifest.live?.active).toBe(true);
});

test("keeps current media active until a replacement window is ready", async () => {
  let releasePrefetch: (() => void) | null = null;
  let quiesced = false;
  let attached = false;
  const prefetchReady = new Promise<void>((resolve) => (releasePrefetch = resolve));
  const task = loadPlayerSessionOnce({
    deps: {
      playback: {
        create: async () => response("unused"),
        position: async (sessionId, request) => window(sessionId, request.generation, false),
        prefetch: async (sessionId, request) => {
          await prefetchReady;
          return window(sessionId, request.generation, true);
        },
        segments: async (sessionId, request) => ({
          ...window(sessionId, request.generation, true),
          manifest,
        }),
      },
      media: {
        attach: async () => {
          expect(quiesced).toBe(true);
          attached = true;
        },
        bufferedRanges: () => [],
      },
      scheduler: {
        appendInit: async () => undefined,
        fill: async () => undefined,
        reset: () => undefined,
      },
      policy: {
        bufferGoalMs: 30_000,
        backBufferMs: 30_000,
        pollIntervalMs: 500,
        manifestRefreshMs: 8_000,
        manifestPollLimit: 2,
        segmentPollLimit: 2,
      },
    },
    config: {
      endpoint: "https://beta.typetype.video/api",
      videoId: "V_YKnVyUJgQ",
      videoItag: 137,
      audioItag: 140,
      audioTrackId: null,
    },
    video: { currentTime: 0 },
    response: response("replacement"),
    current: null,
    quality: undefined,
    startTimeMs: 0,
    signal: new AbortController().signal,
    recovery: new PlaybackRecovery(),
    beforeAttach: async () => {
      quiesced = true;
    },
  });

  await Bun.sleep(0);
  expect(quiesced).toBe(false);
  expect(attached).toBe(false);
  if (!releasePrefetch) throw new Error("Deferred prefetch was not initialized");
  releasePrefetch();
  await task;

  expect(quiesced).toBe(true);
  expect(attached).toBe(true);
});

test("recovers terminal seek windows with a fresh lower video itag session", async () => {
  const createVideoItags: number[] = [];
  const attached: PlaybackManifest[] = [];
  const prefetchRequests: PlaybackWindowRequest[] = [];
  const segmentRequests: PlaybackWindowRequest[] = [];
  const positionRequests: PlaybackWindowRequest["bufferedRanges"][] = [];
  const filledWindows: Array<[number, number, number]> = [];
  const video = { currentTime: 0 };
  const session = await loadPlayerSession({
    deps: {
      playback: {
        create: async (request) => {
          createVideoItags.push(request.videoItag);
          if (request.videoItag === 248) throw new Error("No SABR video for this video");
          return response(`fresh-${request.videoItag}`, request.videoId);
        },
        position: async (_sessionId, request): Promise<PlaybackWindow> => {
          positionRequests.push(request.bufferedRanges);
          return {
            sessionId: _sessionId,
            generation: request.generation,
            ready: false,
            retryAfterMs: null,
            terminalError: null,
            recoveryAction: null,
            retryVideoItags: [],
            manifest: null,
          };
        },
        prefetch: async (sessionId, request): Promise<PlaybackWindow> => {
          prefetchRequests.push(request);
          if (sessionId === "seek-session") {
            return {
              sessionId,
              generation: 1,
              ready: false,
              retryAfterMs: null,
              terminalError: "video:137:12 status=3 protected no-media",
              recoveryAction: "retry_fresh_session_lower_video_itag",
              retryVideoItags: [248, 136, 135],
              manifest: null,
            };
          }
          return {
            sessionId,
            generation: 2,
            ready: true,
            retryAfterMs: null,
            terminalError: null,
            recoveryAction: null,
            retryVideoItags: [],
            manifest,
          };
        },
        segments: async (sessionId, request): Promise<PlaybackWindow> => {
          segmentRequests.push(request);
          if (sessionId === "seek-session") {
            return {
              sessionId,
              generation: 1,
              ready: false,
              retryAfterMs: null,
              terminalError: "video:137:12 status=3 protected no-media",
              recoveryAction: "retry_fresh_session_lower_video_itag",
              retryVideoItags: [248, 136, 135],
              manifest: null,
            };
          }
          return {
            sessionId,
            generation: 2,
            ready: true,
            retryAfterMs: null,
            terminalError: null,
            recoveryAction: null,
            retryVideoItags: [],
            manifest,
          };
        },
      },
      media: {
        attach: async (nextManifest) => attached.push(nextManifest),
        bufferedRanges: () => [{ kind: "video", startMs: 0, endMs: 10_000 }],
      },
      scheduler: {
        reset: () => undefined,
        appendInit: async () => undefined,
        fill: async (nextManifest, startMs, endMs) => {
          filledWindows.push([nextManifest.durationMs, startMs, endMs]);
          expect(video.currentTime).toBe(0);
        },
      },
      policy: {
        bufferGoalMs: 30_000,
        backBufferMs: 30_000,
        pollIntervalMs: 500,
        manifestRefreshMs: 8_000,
        manifestPollLimit: 2,
        segmentPollLimit: 2,
      },
    },
    config: {
      endpoint: "https://beta.typetype.video/api",
      videoId: "V_YKnVyUJgQ",
      videoItag: 137,
      audioItag: 140,
      audioTrackId: null,
    },
    video,
    response: response("seek-session"),
    current: null,
    quality: undefined,
    startTimeMs: 60_000,
    signal: new AbortController().signal,
    recovery: new PlaybackRecovery(),
  });

  expect(session.response.sessionId).toBe("fresh-136");
  expect(session.videoItag).toBe(136);
  expect(video.currentTime).toBe(0);
  expect(createVideoItags).toEqual([248, 136]);
  expect(attached).toHaveLength(1);
  expect(prefetchRequests.map((request) => request.playerTimeMs)).toEqual([60_000, 60_000]);
  expect(prefetchRequests.map((request) => request.videoItag)).toEqual([137, 136]);
  expect(segmentRequests.map((request) => request.videoItag)).toEqual([136]);
  expect(positionRequests[0]).toEqual([]);
  expect(filledWindows).toEqual([[120_000, 59_000, 90_000]]);
});

test("recovers invalid sabr context with a fresh session using the same formats", async () => {
  const created: number[] = [];
  const session = await loadPlayerSession({
    deps: {
      playback: {
        create: async (request) => {
          created.push(request.videoItag);
          return response("fresh-session", request.videoId);
        },
        position: async (sessionId, request) => window(sessionId, request.generation, false),
        prefetch: async (sessionId, request) =>
          sessionId === "stale-session"
            ? {
                ...window(sessionId, request.generation, false),
                terminalError: "Expected UMP response, got content type: text/plain",
                recoveryAction: "retry_fresh_session",
              }
            : { ...window(sessionId, request.generation, true), manifest },
        segments: async (sessionId, request) => ({
          ...window(sessionId, request.generation, true),
          manifest,
        }),
      },
      media: { attach: async () => undefined, bufferedRanges: () => [] },
      scheduler: {
        reset: () => undefined,
        appendInit: async () => undefined,
        fill: async () => undefined,
      },
      policy: {
        bufferGoalMs: 30_000,
        backBufferMs: 30_000,
        pollIntervalMs: 500,
        manifestRefreshMs: 8_000,
        manifestPollLimit: 2,
        segmentPollLimit: 2,
      },
    },
    config: {
      endpoint: "https://beta.typetype.video/api",
      videoId: "Vj6ReOur1Kk",
      videoItag: 137,
      audioItag: 140,
      audioTrackId: "fr-FR.4",
    },
    video: { currentTime: 399.383 },
    response: response("stale-session", "Vj6ReOur1Kk"),
    current: null,
    quality: undefined,
    startTimeMs: 399_383,
    signal: new AbortController().signal,
    recovery: new PlaybackRecovery(),
  });

  expect(created).toEqual([137]);
  expect(session.response.sessionId).toBe("fresh-session");
  expect(session.videoItag).toBe(137);
});

function window(sessionId: string, generation: number | null, ready: boolean): PlaybackWindow {
  return {
    sessionId,
    generation,
    ready,
    retryAfterMs: null,
    terminalError: null,
    recoveryAction: null,
    retryVideoItags: [],
    manifest: null,
  };
}
