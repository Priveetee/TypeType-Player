import { expect, test } from "bun:test";
import { observePlaybackLifecycle } from "../src/playback-lifecycle-observer";

test("wakes playback from PiP media progress without relying on page timers", () => {
  const video = new EventTarget();
  const document = visibilityTarget("visible");
  let wakes = 0;
  const stop = observePlaybackLifecycle(
    () => {
      wakes += 1;
    },
    { document, video },
  );

  video.dispatchEvent(new Event("timeupdate"));
  expect(wakes).toBe(0);
  video.dispatchEvent(new Event("enterpictureinpicture"));
  video.dispatchEvent(new Event("timeupdate"));
  video.dispatchEvent(new Event("leavepictureinpicture"));
  expect(wakes).toBe(3);

  video.dispatchEvent(new Event("timeupdate"));
  expect(wakes).toBe(3);
  stop();
});

test("wakes hidden playback on lifecycle and media events", () => {
  const video = new EventTarget();
  const document = visibilityTarget("hidden");
  let wakes = 0;
  const stop = observePlaybackLifecycle(
    () => {
      wakes += 1;
    },
    { document, video },
  );

  document.dispatchEvent(new Event("visibilitychange"));
  video.dispatchEvent(new Event("timeupdate"));
  video.dispatchEvent(new Event("waiting"));
  document.dispatchEvent(new Event("resume"));
  expect(wakes).toBe(4);

  stop();
  video.dispatchEvent(new Event("stalled"));
  expect(wakes).toBe(4);
});

function visibilityTarget(state: DocumentVisibilityState) {
  const target = new EventTarget() as EventTarget & {
    visibilityState: DocumentVisibilityState;
  };
  target.visibilityState = state;
  return target;
}
