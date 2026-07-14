import { expect, test } from "bun:test";
import type { EventEmitter } from "../src/event-emitter";
import type { HttpClient } from "../src/http-client";
import type { PlaybackManifest } from "../src/manifest";
import type { MediaSourceController } from "../src/media-source-controller";
import { SegmentScheduler } from "../src/segment-scheduler";

const track = {
  kind: "audio" as const,
  mime: 'audio/mp4; codecs="mp4a.40.2"',
  initUrl: "/audio/init",
  segments: [],
};

function manifest(segments: PlaybackManifest["audio"]["segments"]): PlaybackManifest {
  return {
    durationMs: 500_000,
    endOfStream: false,
    audio: { ...track, segments },
    video: null,
  };
}

test("never appends a late segment behind the buffered track edge", async () => {
  const appended: string[] = [];
  let requestedUrl = "";
  const http = {
    response: async (url: string) => {
      requestedUrl = url;
      return new Response(new Uint8Array([1]));
    },
  } as HttpClient;
  const media = {
    append: async () => appended.push(requestedUrl),
  } as MediaSourceController;
  const scheduler = new SegmentScheduler(http, media, { emit: () => undefined } as EventEmitter, 1);
  const segment40 = { url: "/40", startMs: 389_398, durationMs: 9_985 };
  const segment41 = { url: "/41", startMs: 399_383, durationMs: 9_985 };
  const segment42 = { url: "/42", startMs: 409_367, durationMs: 9_985 };
  const segment43 = { url: "/43", startMs: 419_352, durationMs: 9_985 };

  await scheduler.fill(manifest([segment43, segment41, segment42]), 401_200, 430_000);
  await scheduler.fill(manifest([segment40, segment41, segment42, segment43]), 399_383, 430_000);

  expect(appended).toEqual(["/41", "/42", "/43"]);
});

test("rejects fetched bytes from a superseded scheduler revision", async () => {
  let releaseResponse: ((response: Response) => void) | null = null;
  const pendingResponse = new Promise<Response>((resolve) => {
    releaseResponse = resolve;
  });
  const http = { response: async () => pendingResponse } as HttpClient;
  let appends = 0;
  const media = {
    append: async () => {
      appends += 1;
    },
  } as MediaSourceController;
  const scheduler = new SegmentScheduler(http, media, { emit: () => undefined } as EventEmitter, 1);
  const fill = scheduler.fill(
    manifest([{ url: "/old", startMs: 0, durationMs: 10_000 }]),
    0,
    10_000,
  );
  await Bun.sleep(0);
  scheduler.reset();
  if (!releaseResponse) throw new Error("Deferred response was not initialized");
  releaseResponse(new Response(new Uint8Array([1])));

  await expect(fill).rejects.toHaveProperty("name", "AbortError");
  expect(appends).toBe(0);
});
