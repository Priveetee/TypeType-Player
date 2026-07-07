import { expect, test } from "bun:test";
import { resolveBufferPolicy } from "../src/buffer-policy";

test("uses TypeType tuned defaults", () => {
  const policy = resolveBufferPolicy({
    endpoint: "https://example.com/api",
    videoId: "video",
    videoItag: 137,
    audioItag: 140,
    audioTrackId: null,
  });
  expect(policy.bufferGoalMs).toBe(30_000);
  expect(policy.backBufferMs).toBe(30_000);
  expect(policy.pollIntervalMs).toBe(500);
  expect(policy.manifestRefreshMs).toBe(8_000);
});

test("rejects invalid buffer values", () => {
  const policy = resolveBufferPolicy({
    endpoint: "https://example.com/api",
    videoId: "video",
    videoItag: 137,
    audioItag: 140,
    audioTrackId: null,
    bufferGoalMs: -1,
    backBufferMs: Number.NaN,
    pollIntervalMs: 0,
    manifestRefreshMs: 1_500,
  });
  expect(policy.bufferGoalMs).toBe(30_000);
  expect(policy.backBufferMs).toBe(30_000);
  expect(policy.pollIntervalMs).toBe(500);
  expect(policy.manifestRefreshMs).toBe(1_500);
});
