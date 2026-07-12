import { expect, test } from "bun:test";
import { decodeStartMs } from "../src/decode-preroll";
import type { PlaybackManifest } from "../src/manifest";

const manifest: PlaybackManifest = {
  durationMs: 3_554_292,
  endOfStream: false,
  audio: {
    kind: "audio",
    mime: 'audio/mp4; codecs="mp4a.40.2"',
    initUrl: "/140/init",
    segments: [
      { url: "/140/40", startMs: 389_398, durationMs: 9_985 },
      { url: "/140/41", startMs: 399_383, durationMs: 9_985 },
    ],
  },
  video: {
    kind: "video",
    mime: 'video/mp4; codecs="avc1.640028"',
    initUrl: "/137/init",
    segments: [
      { url: "/137/78", startMs: 398_360, durationMs: 3_360 },
      { url: "/137/79", startMs: 401_720, durationMs: 6_840 },
    ],
  },
};

test("starts audiovisual decode from the video sync segment", () => {
  expect(decodeStartMs(manifest, 401_200)).toBe(398_360);
});

test("keeps the target when no video segment contains it", () => {
  expect(decodeStartMs(manifest, 500_000)).toBe(500_000);
});

test("keeps the target for audio-only manifests", () => {
  expect(decodeStartMs({ ...manifest, video: null }, 401_200)).toBe(401_200);
});
