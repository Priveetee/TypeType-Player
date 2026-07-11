import { expect, test } from "bun:test";
import { AppendQueue } from "../src/append-queue";

class FakeSourceBuffer extends EventTarget {
  updating = false;
  readonly buffered = { length: 0 } as TimeRanges;

  appendBuffer(): void {
    this.updating = true;
  }

  abort(): void {
    this.updating = false;
  }

  remove(): void {
    this.updating = true;
  }
}

test("clear rejects active and queued appends", async () => {
  const source = new FakeSourceBuffer();
  const queue = new AppendQueue(source as unknown as SourceBuffer);
  const active = queue.append(new ArrayBuffer(1));
  const pending = queue.append(new ArrayBuffer(1));

  queue.clear();

  await expect(active).rejects.toMatchObject({ name: "AbortError" });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(source.updating).toBe(false);
});
