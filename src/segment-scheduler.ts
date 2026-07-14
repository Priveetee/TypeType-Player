import type { EventEmitter } from "./event-emitter";
import type { HttpClient } from "./http-client";
import type { ManifestSegment, PlaybackManifest } from "./manifest";
import type { MediaSourceController } from "./media-source-controller";
import { fetchSegmentBytes } from "./segment-fetcher";
import type { TrackKind } from "./types";

export class SegmentScheduler {
  private readonly appended = new Set<string>();
  private readonly appendedEndMs = new Map<TrackKind, number>();
  private revision = 0;

  constructor(
    private readonly http: HttpClient,
    private readonly media: MediaSourceController,
    private readonly emitter: EventEmitter,
    private readonly pollLimit: number,
  ) {}

  reset(): void {
    this.revision += 1;
    this.appended.clear();
    this.appendedEndMs.clear();
  }

  async appendInit(manifest: PlaybackManifest, signal?: AbortSignal): Promise<void> {
    const revision = this.revision;
    const tasks = [this.appendUrl("audio", manifest.audio.initUrl, 0, 0, revision, signal)];
    if (manifest.video) {
      tasks.push(this.appendUrl("video", manifest.video.initUrl, 0, 0, revision, signal));
    }
    await Promise.all(tasks);
  }

  async fill(
    manifest: PlaybackManifest,
    currentMs: number,
    goalMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const revision = this.revision;
    const tasks = [
      this.fillTrack("audio", manifest.audio.segments, currentMs, goalMs, revision, signal),
    ];
    if (manifest.video) {
      tasks.push(
        this.fillTrack("video", manifest.video.segments, currentMs, goalMs, revision, signal),
      );
    }
    await Promise.all(tasks);
  }

  private async fillTrack(
    kind: TrackKind,
    segments: ManifestSegment[],
    currentMs: number,
    goalMs: number,
    revision: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const candidates = segments
      .filter(
        (segment) => segment.startMs + segment.durationMs > currentMs && segment.startMs <= goalMs,
      )
      .sort((left, right) => left.startMs - right.startMs);
    for (const segment of candidates) {
      const segmentEndMs = segment.startMs + segment.durationMs;
      const appendedEndMs = this.appendedEndMs.get(kind);
      if (appendedEndMs !== undefined && segmentEndMs <= appendedEndMs) continue;
      await this.appendUrl(
        kind,
        segment.url,
        segment.startMs,
        segment.durationMs,
        revision,
        signal,
      );
      this.appendedEndMs.set(kind, Math.max(appendedEndMs ?? 0, segmentEndMs));
    }
  }

  private async appendUrl(
    kind: TrackKind,
    url: string,
    startMs: number,
    durationMs: number,
    revision: number,
    signal?: AbortSignal,
  ): Promise<void> {
    this.ensureActive(revision, signal);
    const key = `${kind}:${url}`;
    if (this.appended.has(key)) return;
    const bytes = await fetchSegmentBytes(this.http, url, this.pollLimit, signal);
    this.ensureActive(revision, signal);
    await this.media.append(kind, bytes);
    this.ensureActive(revision, signal);
    this.appended.add(key);
    this.emitter.emit({ type: "segment", kind, url, startMs, durationMs });
  }

  private ensureActive(revision: number, signal?: AbortSignal): void {
    if (revision !== this.revision || signal?.aborted) {
      throw new DOMException("Operation aborted", "AbortError");
    }
  }
}
