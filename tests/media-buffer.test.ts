import { expect, test } from "bun:test";
import { bufferedEndAtCurrentTime, seekWithinBufferedMedia } from "../src/media-buffer";

test("uses the buffered range containing the playhead instead of the final range", () => {
  const video = media(
    [
      [0, 10],
      [40, 70],
    ],
    5,
  );

  expect(bufferedEndAtCurrentTime(video)).toBe(10_000);
  video.currentTime = 50;
  expect(bufferedEndAtCurrentTime(video)).toBe(70_000);
});

test("does not report media beyond a gap as buffered at the playhead", () => {
  expect(
    bufferedEndAtCurrentTime(
      media(
        [
          [0, 10],
          [40, 70],
        ],
        20,
      ),
    ),
  ).toBe(0);
});

test("seeks locally only when the target has enough buffered media", () => {
  const video = media(
    [
      [0, 30],
      [60, 90],
    ],
    5,
  );

  expect(seekWithinBufferedMedia(video, 20_000)).toBe(true);
  expect(video.currentTime).toBe(20);
  expect(seekWithinBufferedMedia(video, 45_000)).toBe(false);
  expect(seekWithinBufferedMedia(video, 89_900)).toBe(false);
});

function media(ranges: Array<[number, number]>, currentTime: number) {
  return {
    currentTime,
    buffered: {
      length: ranges.length,
      start: (index: number) => ranges[index]?.[0] ?? 0,
      end: (index: number) => ranges[index]?.[1] ?? 0,
    },
  } as HTMLVideoElement;
}
