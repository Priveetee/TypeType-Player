import { expect, test } from "bun:test";
import { PlayerOperation } from "../src/player-operation";

test("advances revisions and aborts the previous operation", () => {
  const operation = new PlayerOperation();
  const initialSignal = operation.signal;

  const firstRevision = operation.next();
  const firstSignal = operation.signal;
  const secondRevision = operation.next();

  expect(firstRevision).toBe(1);
  expect(secondRevision).toBe(2);
  expect(initialSignal.aborted).toBe(true);
  expect(firstSignal.aborted).toBe(true);
  expect(operation.signal.aborted).toBe(false);
  expect(() => operation.ensureCurrent(false, firstRevision)).toThrow("Operation aborted");
  expect(() => operation.ensureCurrent(false, secondRevision)).not.toThrow();
});

test("rejects current revisions after player destruction", () => {
  const operation = new PlayerOperation();
  const revision = operation.next();

  expect(() => operation.ensureCurrent(true, revision)).toThrow("Operation aborted");
});
