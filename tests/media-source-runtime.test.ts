import { expect, test } from "bun:test";
import {
  createMediaSource,
  isMseTypeSupportedForScope,
  type MediaSourceRuntimeScope,
} from "../src/media-source-runtime";

test("prefers ManagedMediaSource when both runtimes are available", () => {
  const scope = runtimeScope();

  const created = createMediaSource(scope);

  expect(created.managed).toBe(true);
  expect(created.mediaSource).toBeInstanceOf(scope.ManagedMediaSource as never);
});

test("falls back to MediaSource", () => {
  const scope = runtimeScope();
  delete scope.ManagedMediaSource;

  const created = createMediaSource(scope);

  expect(created.managed).toBe(false);
  expect(created.mediaSource).toBeInstanceOf(scope.MediaSource as never);
});

test("reports unsupported when neither runtime exists", () => {
  expect(isMseTypeSupportedForScope('video/mp4; codecs="avc1.640028"', {})).toBe(false);
  expect(() => createMediaSource({})).toThrow("Media Source Extensions are not available");
});

test("checks codec support against the selected runtime", () => {
  const scope = runtimeScope();

  expect(isMseTypeSupportedForScope("managed", scope)).toBe(true);
  expect(isMseTypeSupportedForScope("standard", scope)).toBe(false);
});

function runtimeScope(): MediaSourceRuntimeScope {
  class FakeMediaSource {}
  class FakeManagedMediaSource {}
  return {
    ManagedMediaSource: Object.assign(FakeManagedMediaSource, {
      isTypeSupported: (mime: string) => mime === "managed",
    }) as unknown as NonNullable<MediaSourceRuntimeScope["ManagedMediaSource"]>,
    MediaSource: Object.assign(FakeMediaSource, {
      isTypeSupported: (mime: string) => mime === "standard",
    }) as unknown as NonNullable<MediaSourceRuntimeScope["MediaSource"]>,
  };
}
