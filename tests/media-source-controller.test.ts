import { expect, test } from "bun:test";
import type { PlaybackManifest } from "../src/manifest";
import { MediaSourceController } from "../src/media-source-controller";

type ControllerState = {
  objectUrl: string | null;
  mediaSource: MediaSource | null;
  audioMime: string | null;
  videoMime: string | null;
};

const audio = {
  kind: "audio" as const,
  mime: 'audio/mp4; codecs="mp4a.40.2"',
  initUrl: "/audio/init",
  segments: [],
};

function manifest(video: boolean): PlaybackManifest {
  return {
    durationMs: 120_000,
    endOfStream: false,
    audio,
    video: video
      ? {
          kind: "video",
          mime: 'video/mp4; codecs="avc1.640028"',
          initUrl: "/video/init",
          segments: [],
        }
      : null,
  };
}

function videoElement(src: string) {
  const calls: string[] = [];
  return {
    calls,
    video: {
      src,
      removeAttribute: (name: string) => calls.push(`remove:${name}`),
      load: () => calls.push("load"),
    } as unknown as HTMLVideoElement,
  };
}

test("detach releases the media source owned by the controller", () => {
  const { calls, video } = videoElement("blob:owned");
  const controller = new MediaSourceController(video);
  (controller as unknown as ControllerState).objectUrl = "blob:owned";

  controller.detach();

  expect(calls).toEqual(["remove:src", "load"]);
});

test("stale controller cannot detach a replacement media source", () => {
  const { calls, video } = videoElement("blob:replacement");
  const controller = new MediaSourceController(video);
  (controller as unknown as ControllerState).objectUrl = "blob:stale";

  controller.detach();

  expect(calls).toEqual([]);
  expect(video.src).toBe("blob:replacement");
});

test("attach reuses source buffers when the track layout is compatible", async () => {
  const mediaSource = new FakeMediaSource();
  mediaSource.addSourceBuffer();
  mediaSource.addSourceBuffer();
  const firstBuffers = [...mediaSource.sourceBuffers];
  const video = {
    src: "blob:stable",
    removeAttribute: () => undefined,
    load: () => undefined,
  } as unknown as HTMLVideoElement;
  const controller = new MediaSourceController(video);
  const state = controller as unknown as ControllerState;
  state.objectUrl = "blob:stable";
  state.mediaSource = mediaSource as unknown as MediaSource;
  state.audioMime = manifest(true).audio.mime;
  state.videoMime = manifest(true).video?.mime ?? null;

  await controller.attach(manifest(true));

  expect(video.src).toBe("blob:stable");
  expect(mediaSource.removed).toEqual([]);
  expect(mediaSource.sourceBuffers).toEqual(firstBuffers);
});

test("attach replaces the media source when the track layout changes", async () => {
  const current = new FakeMediaSource();
  current.addSourceBuffer();
  current.addSourceBuffer();
  const replacements: FakeMediaSource[] = [];
  const { video } = videoElement("blob:stable");
  const controller = new MediaSourceController(video, {
    create: () => {
      const mediaSource = new FakeMediaSource("closed");
      replacements.push(mediaSource);
      queueMicrotask(() => mediaSource.open());
      return mediaSource as unknown as MediaSource;
    },
    createObjectUrl: () => `blob:replacement-${replacements.length}`,
    revokeObjectUrl: () => undefined,
  });
  const state = controller as unknown as ControllerState;
  state.objectUrl = "blob:stable";
  state.mediaSource = current as unknown as MediaSource;
  state.audioMime = manifest(true).audio.mime;
  state.videoMime = manifest(true).video?.mime ?? null;

  await controller.attach(manifest(false));
  await controller.attach(manifest(true));

  expect(replacements).toHaveLength(2);
  expect(current.removed).toEqual([]);
  expect(replacements[0].removed).toEqual([]);
  expect(video.src).toBe("blob:replacement-2");
});

class FakeMediaSource {
  readonly sourceBuffers: SourceBuffer[] = [];
  readonly removed: SourceBuffer[] = [];
  duration = Number.NaN;
  readyState: ReadyState;
  private readonly listeners = new Map<string, () => void>();

  constructor(readyState: ReadyState = "open") {
    this.readyState = readyState;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === "function") this.listeners.set(type, listener as () => void);
  }

  addSourceBuffer(): SourceBuffer {
    const buffer = {
      updating: false,
      buffered: { length: 0 },
      abort: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as SourceBuffer;
    this.sourceBuffers.push(buffer);
    return buffer;
  }

  removeSourceBuffer(buffer: SourceBuffer): void {
    this.removed.push(buffer);
    this.sourceBuffers.splice(this.sourceBuffers.indexOf(buffer), 1);
  }

  open(): void {
    this.readyState = "open";
    this.listeners.get("sourceopen")?.();
  }
}
