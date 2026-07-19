import { AppendQueue } from "./append-queue";
import type { ManifestTrack, PlaybackManifest } from "./manifest";
import type { TrackKind } from "./types";

export type MediaBufferedRange = {
  kind: TrackKind;
  startMs: number;
  endMs: number;
};

type MediaSourcePlatform = {
  create: () => MediaSource;
  createObjectUrl: (mediaSource: MediaSource) => string;
  revokeObjectUrl: (url: string) => void;
};

const browserMediaSourcePlatform: MediaSourcePlatform = {
  create: () => new MediaSource(),
  createObjectUrl: (mediaSource) => URL.createObjectURL(mediaSource),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
};

export class MediaSourceController {
  private objectUrl: string | null = null;
  private audioQueue: AppendQueue | null = null;
  private videoQueue: AppendQueue | null = null;
  private mediaSource: MediaSource | null = null;
  private audioMime: string | null = null;
  private videoMime: string | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly platform = browserMediaSourcePlatform,
  ) {}

  static supported(manifest: PlaybackManifest): boolean {
    return (
      MediaSource.isTypeSupported(manifest.audio.mime) &&
      (!manifest.video || MediaSource.isTypeSupported(manifest.video.mime))
    );
  }

  async attach(manifest: PlaybackManifest): Promise<void> {
    const mediaSource = this.reusableMediaSource();
    if (mediaSource && this.hasCompatibleLayout(manifest)) {
      await this.resetSourceBuffers(mediaSource, manifest);
      return;
    }
    this.detach();
    await this.attachNewMediaSource(manifest);
  }

  private async attachNewMediaSource(manifest: PlaybackManifest): Promise<void> {
    const mediaSource = this.platform.create();
    this.mediaSource = mediaSource;
    this.objectUrl = this.platform.createObjectUrl(mediaSource);
    this.video.src = this.objectUrl;
    await new Promise<void>((resolve, reject) => {
      const sourceOpen = () => resolve();
      const sourceClose = () => reject(new DOMException("Operation aborted", "AbortError"));
      mediaSource.addEventListener("sourceopen", sourceOpen, { once: true });
      mediaSource.addEventListener("sourceclose", sourceClose, { once: true });
    });
    if (this.mediaSource !== mediaSource) throw new DOMException("Operation aborted", "AbortError");
    this.createSourceBuffers(mediaSource, manifest);
  }

  private reusableMediaSource(): MediaSource | null {
    const mediaSource = this.mediaSource;
    if (mediaSource?.readyState !== "open") return null;
    if (!this.objectUrl || this.video.src !== this.objectUrl) return null;
    return mediaSource;
  }

  private hasCompatibleLayout(manifest: PlaybackManifest): boolean {
    return this.audioMime === manifest.audio.mime && this.videoMime === manifest.video?.mime;
  }

  private async resetSourceBuffers(
    mediaSource: MediaSource,
    manifest: PlaybackManifest,
  ): Promise<void> {
    await Promise.all([this.audioQueue?.reset(), this.videoQueue?.reset()]);
    this.applyTiming(mediaSource, manifest);
  }

  private createSourceBuffers(mediaSource: MediaSource, manifest: PlaybackManifest): void {
    this.applyTiming(mediaSource, manifest);
    this.audioQueue = new AppendQueue(mediaSource.addSourceBuffer(manifest.audio.mime));
    this.videoQueue = manifest.video
      ? new AppendQueue(mediaSource.addSourceBuffer(manifest.video.mime))
      : null;
    this.audioMime = manifest.audio.mime;
    this.videoMime = manifest.video?.mime ?? null;
  }

  updateTiming(manifest: PlaybackManifest): void {
    const mediaSource = this.mediaSource;
    if (mediaSource?.readyState !== "open") return;
    this.applyTiming(mediaSource, manifest);
  }

  append(kind: TrackKind, data: ArrayBuffer): Promise<void> {
    const queue = kind === "audio" ? this.audioQueue : this.videoQueue;
    if (!queue) return Promise.reject(new Error(`${kind} SourceBuffer is not ready`));
    return queue.append(data);
  }

  async trim(currentTimeMs: number, backBufferMs: number): Promise<void> {
    const removeEnd = Math.max(0, currentTimeMs - backBufferMs) / 1000;
    await Promise.all([
      this.audioQueue?.remove(0, removeEnd),
      this.videoQueue?.remove(0, removeEnd),
    ]);
  }

  clear(): void {
    this.audioQueue?.clear();
    this.videoQueue?.clear();
  }

  endOfStream(): boolean {
    const mediaSource = this.mediaSource;
    if (!mediaSource) return false;
    if (mediaSource.readyState === "ended") return true;
    if (mediaSource.readyState !== "open") return false;
    mediaSource.endOfStream();
    return true;
  }

  bufferedRanges(): MediaBufferedRange[] {
    return [
      ...this.queueRanges("audio", this.audioQueue),
      ...this.queueRanges("video", this.videoQueue),
    ];
  }

  detach(): void {
    const mediaSource = this.mediaSource;
    this.destroyQueues();
    const ownsMediaElement = this.objectUrl !== null && this.video.src === this.objectUrl;
    if (mediaSource?.readyState === "open") {
      for (const sourceBuffer of Array.from(mediaSource.sourceBuffers)) {
        mediaSource.removeSourceBuffer(sourceBuffer);
      }
    }
    this.mediaSource = null;
    if (ownsMediaElement) {
      this.video.removeAttribute("src");
      this.video.load();
    }
    if (this.objectUrl) this.platform.revokeObjectUrl(this.objectUrl);
    this.objectUrl = null;
  }

  track(kind: TrackKind, manifest: PlaybackManifest): ManifestTrack | null {
    return kind === "audio" ? manifest.audio : manifest.video;
  }

  private queueRanges(kind: TrackKind, queue: AppendQueue | null): MediaBufferedRange[] {
    if (!queue) return [];
    const buffered = queue.buffered();
    const ranges: MediaBufferedRange[] = [];
    for (let index = 0; index < buffered.length; index += 1) {
      ranges.push({
        kind,
        startMs: Math.round(buffered.start(index) * 1000),
        endMs: Math.round(buffered.end(index) * 1000),
      });
    }
    return ranges;
  }

  private destroyQueues(): void {
    this.audioQueue?.destroy();
    this.videoQueue?.destroy();
    this.audioQueue = null;
    this.videoQueue = null;
    this.audioMime = null;
    this.videoMime = null;
  }

  private applyTiming(mediaSource: MediaSource, manifest: PlaybackManifest): void {
    const live = manifest.live;
    if (live?.active) {
      mediaSource.duration = Number.POSITIVE_INFINITY;
      if (typeof mediaSource.setLiveSeekableRange === "function") {
        mediaSource.setLiveSeekableRange(live.seekableStartMs / 1000, live.seekableEndMs / 1000);
      }
      return;
    }
    if (typeof mediaSource.clearLiveSeekableRange === "function") {
      mediaSource.clearLiveSeekableRange();
    }
    mediaSource.duration = manifest.durationMs > 0 ? manifest.durationMs / 1000 : Number.NaN;
  }
}
