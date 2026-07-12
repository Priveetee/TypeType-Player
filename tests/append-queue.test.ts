import { expect, test } from "bun:test";
import { AppendQueue } from "../src/append-queue";

class FakeSourceBuffer extends EventTarget {
  updating = false;
  readonly removed: Array<[number, number]> = [];

  constructor(private readonly ranges: Array<[number, number]> = []) {
    super();
  }

  get buffered(): TimeRanges {
    return {
      length: this.ranges.length,
      start: (index) => this.ranges[index]?.[0] ?? 0,
      end: (index) => this.ranges[index]?.[1] ?? 0,
    };
  }

  appendBuffer(): void {
    this.updating = true;
  }

  abort(): void {
    this.updating = false;
  }

  remove(start: number, end: number): void {
    this.removed.push([start, end]);
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

test("reset removes every buffered range without replacing the source buffer", async () => {
  const source = new FakeSourceBuffer([
    [4, 8],
    [12, 20],
  ]);
  const queue = new AppendQueue(source as unknown as SourceBuffer);

  const reset = queue.reset();
  expect(source.removed).toEqual([[4, 20]]);
  source.updating = false;
  source.dispatchEvent(new Event("updateend"));

  await reset;
});
