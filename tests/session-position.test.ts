import { expect, test } from "bun:test";
import { shouldApplySessionPosition } from "../src/session-position";

test("keeps an initial zero position unchanged", () => {
  expect(shouldApplySessionPosition(0, false)).toBe(false);
});

test("applies a nonzero initial position", () => {
  expect(shouldApplySessionPosition(10_000, false)).toBe(true);
});

test("applies an exact zero seek", () => {
  expect(shouldApplySessionPosition(0, true)).toBe(true);
});

test("applies a nonzero seek", () => {
  expect(shouldApplySessionPosition(10_000, true)).toBe(true);
});
