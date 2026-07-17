import { expect, test } from "bun:test";
import { LiveEdgeFollower } from "../src/live-edge-follower";
import type { LivePlaybackWindow } from "../src/manifest";

const LIVE: LivePlaybackWindow = {
  active: true,
  postLiveDvr: false,
  headSequence: 500,
  headTimeMs: 1_000_000,
  seekableStartMs: 100_000,
  seekableEndMs: 1_000_000,
  atLiveEdge: true,
  targetLatencyMs: 10_000,
};

test("follows an active live session and coalesces catch-up seeks", () => {
  const follower = new LiveEdgeFollower(true);
  follower.initialize(990_000, LIVE);

  expect(follower.isFollowing).toBe(true);
  expect(
    follower.nextTarget({ positionMs: 971_000, live: LIVE, paused: false, busy: false, nowMs: 0 }),
  ).toBeNull();
  expect(
    follower.nextTarget({ positionMs: 969_000, live: LIVE, paused: false, busy: false, nowMs: 1 }),
  ).toBe(990_000);
  expect(
    follower.nextTarget({ positionMs: 960_000, live: LIVE, paused: false, busy: false, nowMs: 2 }),
  ).toBeNull();
  expect(
    follower.nextTarget({
      positionMs: 960_000,
      live: LIVE,
      paused: false,
      busy: false,
      nowMs: 15_001,
    }),
  ).toBe(990_000);
});

test("leaves live following for a DVR seek and rejoins near the edge", () => {
  const follower = new LiveEdgeFollower(true);
  follower.initialize(990_000, LIVE);

  follower.observeUserSeek(800_000, LIVE);
  expect(follower.isFollowing).toBe(false);
  expect(
    follower.nextTarget({ positionMs: 800_000, live: LIVE, paused: false, busy: false, nowMs: 0 }),
  ).toBeNull();

  follower.observeUserSeek(985_000, LIVE);
  expect(follower.isFollowing).toBe(true);
});

test("does not catch up while paused or during another player operation", () => {
  const follower = new LiveEdgeFollower(true);
  follower.initialize(990_000, LIVE);

  expect(
    follower.nextTarget({ positionMs: 900_000, live: LIVE, paused: true, busy: false, nowMs: 0 }),
  ).toBeNull();
  expect(
    follower.nextTarget({ positionMs: 900_000, live: LIVE, paused: false, busy: true, nowMs: 0 }),
  ).toBeNull();
  expect(
    follower.nextTarget({ positionMs: 900_000, live: LIVE, paused: false, busy: false, nowMs: 0 }),
  ).toBe(990_000);
});

test("stays disabled for non-live playback", () => {
  const follower = new LiveEdgeFollower(false);
  follower.initialize(990_000, LIVE);

  expect(follower.isFollowing).toBe(false);
  expect(
    follower.nextTarget({ positionMs: 900_000, live: LIVE, paused: false, busy: false, nowMs: 0 }),
  ).toBeNull();
});
