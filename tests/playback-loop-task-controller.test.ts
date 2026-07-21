import { expect, test } from "bun:test";
import { PlaybackLoopTaskController } from "../src/playback-loop-task-controller";

test("isolates each loop cycle while following the active operation", () => {
  const tasks = new PlaybackLoopTaskController();
  const firstOperation = new AbortController();
  const first = tasks.signal(firstOperation.signal);

  firstOperation.abort();
  expect(first.aborted).toBe(true);

  const replacementOperation = new AbortController();
  const replacement = tasks.signal(replacementOperation.signal);
  expect(replacement.aborted).toBe(false);

  tasks.stop();
  expect(replacement.aborted).toBe(true);

  const replacementFill = tasks.signal(replacementOperation.signal);
  expect(replacementFill.aborted).toBe(false);
  expect(replacementFill).not.toBe(replacement);
});
