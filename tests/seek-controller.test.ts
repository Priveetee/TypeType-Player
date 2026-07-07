import { expect, test } from "bun:test";
import { SeekController } from "../src/seek-controller";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolveValue: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolveValue = resolve;
  });
  if (!resolveValue) throw new Error("Deferred promise was not initialized");
  return { promise, resolve: resolveValue };
}

test("coalesces seeks to the latest pending position", async () => {
  const controller = new SeekController();
  const first = deferred();
  const positions: number[] = [];
  const running = controller.seek(10, async (position) => {
    positions.push(position);
    if (position === 10) await first.promise;
  });
  controller.seek(20, async () => undefined);
  controller.seek(30, async () => undefined);
  first.resolve();
  await running;
  expect(positions).toEqual([10, 30]);
});
