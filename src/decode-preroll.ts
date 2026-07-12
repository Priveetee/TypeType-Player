import type { PlaybackManifest } from "./manifest";

const PREROLL_RATE = 16;
const TARGET_TOLERANCE_MS = 80;
const TARGET_BOUNDARY_TOLERANCE_MS = 1;
const PAUSED_SEEK_TIMEOUT_MS = 5_000;
const MIN_PREROLL_TIMEOUT_MS = 5_000;
const MAX_PREROLL_TIMEOUT_MS = 15_000;

export function decodeStartMs(manifest: PlaybackManifest, targetMs: number): number {
  if (!manifest.video) return targetMs;
  const audio = manifest.audio.segments.find(
    (item) => item.startMs <= targetMs && item.startMs + item.durationMs > targetMs,
  );
  if (audio && Math.abs(audio.startMs - targetMs) <= TARGET_BOUNDARY_TOLERANCE_MS) return targetMs;
  const video = manifest.video.segments.find(
    (item) => item.startMs <= targetMs && item.startMs + item.durationMs > targetMs,
  );
  return video?.startMs ?? targetMs;
}

export async function runDecodePreroll(
  video: HTMLVideoElement,
  targetMs: number,
  resumePlayback: boolean,
  signal: AbortSignal,
): Promise<void> {
  if (video.currentTime * 1000 >= targetMs - TARGET_TOLERANCE_MS) return;
  const muted = video.muted;
  const playbackRate = video.playbackRate;
  const autoplay = video.autoplay;
  video.muted = true;
  video.playbackRate = PREROLL_RATE;
  video.autoplay = true;
  try {
    await video.play();
    await waitForTarget(video, targetMs, signal);
  } finally {
    video.playbackRate = playbackRate;
    video.muted = muted;
    video.autoplay = autoplay;
    if (!resumePlayback) video.pause();
    else if (!signal.aborted) await video.play();
  }
}

export function seekPausedFrame(
  video: HTMLVideoElement,
  targetMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Operation aborted", "AbortError"));
  if (Math.abs(video.currentTime * 1000 - targetMs) <= TARGET_TOLERANCE_MS)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      video.removeEventListener("seeked", seeked);
    };
    const finish = (callback: () => void) => {
      cleanup();
      callback();
    };
    const abort = () => finish(() => reject(new DOMException("Operation aborted", "AbortError")));
    const seeked = () => finish(resolve);
    const timeout = setTimeout(
      () => finish(() => reject(new Error("Paused seek timed out"))),
      PAUSED_SEEK_TIMEOUT_MS,
    );
    signal.addEventListener("abort", abort, { once: true });
    video.addEventListener("seeked", seeked, { once: true });
    video.currentTime = targetMs / 1000;
  });
}

function waitForTarget(
  video: HTMLVideoElement,
  targetMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const decodeDistanceMs = Math.max(0, targetMs - video.currentTime * 1000);
    const timeoutMs = Math.min(
      MAX_PREROLL_TIMEOUT_MS,
      Math.max(MIN_PREROLL_TIMEOUT_MS, decodeDistanceMs * 2),
    );
    const startedAt = performance.now();
    const poll = () => {
      if (signal.aborted) return reject(new DOMException("Operation aborted", "AbortError"));
      if (video.error) return reject(new Error(video.error.message));
      if (video.currentTime * 1000 >= targetMs - TARGET_TOLERANCE_MS) return resolve();
      if (performance.now() - startedAt >= timeoutMs)
        return reject(new Error("Decode preroll timed out"));
      setTimeout(poll, 10);
    };
    poll();
  });
}
