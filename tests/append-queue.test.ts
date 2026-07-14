import { expect, test } from "bun:test";
import { AppendQueue } from "../src/append-queue";

class FakeSourceBuffer extends EventTarget {
  updating = false;
  operation: "append" | "remove" | null = null;
  abortCalls = 0;
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
    this.operation = "append";
    this.updating = true;
  }

  abort(): void {
    if (this.operation === "remove") {
      throw new DOMException(
        "Aborting asynchronous remove() operation is disallowed",
        "InvalidStateError",
      );
    }
    this.abortCalls += 1;
    this.operation = null;
    this.updating = false;
  }

  remove(start: number, end: number): void {
    this.removed.push([start, end]);
    this.operation = "remove";
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
  expect(source.abortCalls).toBe(1);
  expect(source.updating).toBe(false);
});

test("clear does not abort an active remove", async () => {
  const source = new FakeSourceBuffer([[0, 10]]);
  const queue = new AppendQueue(source as unknown as SourceBuffer);
  const active = queue.remove(0, 5);

  queue.clear();

  await expect(active).rejects.toMatchObject({ name: "AbortError" });
  expect(source.abortCalls).toBe(0);
  expect(source.updating).toBe(true);
});

test("destroy does not abort an active remove", async () => {
  const source = new FakeSourceBuffer([[0, 10]]);
  const queue = new AppendQueue(source as unknown as SourceBuffer);
  const active = queue.remove(0, 5);

  queue.destroy();

  await expect(active).rejects.toMatchObject({ name: "AbortError" });
  expect(source.abortCalls).toBe(0);
  expect(source.updating).toBe(true);
});

test("reset removes every buffered range without replacing the source buffer", async () => {
  const source = new FakeSourceBuffer([
    [4, 8],
    [12, 20],
  ]);
  const queue = new AppendQueue(source as unknown as SourceBuffer);

  const reset = queue.reset();
  expect(source.removed).toEqual([[4, 20]]);
  source.operation = null;
  source.updating = false;
  source.dispatchEvent(new Event("updateend"));

  await reset;
});
