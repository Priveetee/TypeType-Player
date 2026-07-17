import { expect, test } from "bun:test";
import type { HttpClient } from "../src/http-client";
import { PlaybackClient } from "../src/playback-client";

test("creates live playback sessions and parses live timing", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const http = {
    json: async (path: string, init?: RequestInit) => {
      requests.push({ path, init });
      return {
        sessionId: "live-session",
        videoId: "X4VbdwhkE10",
        generation: 0,
        ready: true,
        retryAfterMs: null,
        startTimeMs: 3_590_000,
        live: {
          active: true,
          postLiveDvr: false,
          headSequence: 720,
          headTimeMs: 3_600_000,
          seekableStartMs: 0,
          seekableEndMs: 3_600_000,
          atLiveEdge: true,
          targetLatencyMs: 10_000,
        },
      };
    },
    absolute: (path: string) => `https://beta.typetype.video/api${path}`,
  } as unknown as HttpClient;

  const response = await new PlaybackClient(http).create({
    videoId: "X4VbdwhkE10",
    videoItag: 137,
    audioItag: 140,
    audioTrackId: null,
    startTimeMs: 0,
    audioOnly: false,
    isLive: true,
  });

  expect(requests[0]?.path).toContain("/sabr/playback/X4VbdwhkE10?");
  expect(requests[0]?.path).toContain("isLive=true");
  expect(requests[0]?.init?.method).toBe("POST");
  expect(response.startTimeMs).toBe(3_590_000);
  expect(response.live).toMatchObject({ active: true, headSequence: 720 });
});
