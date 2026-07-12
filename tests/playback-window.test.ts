import { expect, test } from "bun:test";
import { parsePlaybackWindow } from "../src/playback-window";

test("parses native playback windows", () => {
  const window = parsePlaybackWindow(
    {
      sessionId: "session",
      generation: 2,
      ready: true,
      retryAfterMs: null,
      terminalError: null,
      status: "requesting",
      blockedBy: "video:299:2 pending",
      bufferedEdgeMs: 5000,
      durationMs: 120_000,
      endOfStream: true,
      audio: {
        mime: 'audio/mp4; codecs="mp4a.40.2"',
        initUrl: "/api/sabr/playback/session/140/init?generation=2",
        segments: [
          { url: "/api/sabr/playback/session/140/segment/13", startMs: 120_000, durationMs: 5_000 },
        ],
      },
      video: {
        mime: 'video/mp4; codecs="avc1.640028"',
        initUrl: "/api/sabr/playback/session/137/init?generation=2",
        segments: [
          { url: "/api/sabr/playback/session/137/segment/24", startMs: 119_604, durationMs: 5_000 },
        ],
      },
    },
    "https://beta.typetype.video/api/sabr/playback/session/window",
  );
  expect(window.generation).toBe(2);
  expect(window.manifest?.endOfStream).toBe(true);
  expect(window.terminalError).toBeNull();
  expect(window.status).toBe("requesting");
  expect(window.blockedBy).toBe("video:299:2 pending");
  expect(window.bufferedEdgeMs).toBe(5000);
  expect(window.manifest?.video.segments[0]?.url).toBe(
    "https://beta.typetype.video/api/sabr/playback/session/137/segment/24",
  );
});

test("parses playback window recovery hints", () => {
  const window = parsePlaybackWindow(
    {
      sessionId: "session",
      generation: 1,
      ready: false,
      retryAfterMs: 500,
      terminalError: "video:137:12 status=3 protected no-media",
      recoveryAction: "retry_fresh_session_lower_video_itag",
      retryVideoItags: [136, 135, 134],
    },
    "https://beta.typetype.video/api/sabr/playback/session/window",
  );
  expect(window.manifest).toBeNull();
  expect(window.recoveryAction).toBe("retry_fresh_session_lower_video_itag");
  expect(window.retryVideoItags).toEqual([136, 135, 134]);
});

test("parses fresh session recovery without changing formats", () => {
  const window = parsePlaybackWindow(
    {
      sessionId: "session",
      generation: 1,
      ready: false,
      terminalError: "Expected UMP response, got content type: text/plain",
      recoveryAction: "retry_fresh_session",
      retryVideoItags: [],
    },
    "https://beta.typetype.video/api/sabr/playback/session/window",
  );
  expect(window.recoveryAction).toBe("retry_fresh_session");
  expect(window.retryVideoItags).toEqual([]);
});

test("parses audio-only playback windows", () => {
  const window = parsePlaybackWindow(
    {
      sessionId: "audio-session",
      generation: 3,
      ready: true,
      durationMs: 420_000,
      endOfStream: false,
      audio: {
        mime: 'audio/mp4; codecs="mp4a.40.2"',
        initUrl: "/api/sabr/playback/audio-session/140/init?generation=3",
        segments: [
          {
            url: "/api/sabr/playback/audio-session/140/segment/8?generation=3",
            startMs: 69_895,
            durationMs: 9_985,
          },
        ],
      },
      video: null,
    },
    "https://beta.typetype.video/api/sabr/playback/audio-session/segments",
  );
  expect(window.manifest?.video).toBeNull();
  expect(window.manifest?.audio.segments[0]?.startMs).toBe(69_895);
});
