import type { TrackKind } from "./types";

/** Resolved media segment exposed by a TypeType playback window. */
export type ManifestSegment = {
  url: string;
  startMs: number;
  durationMs: number;
};

/** Audio or video track containing initialization data and ordered segments. */
export type ManifestTrack = {
  kind: TrackKind;
  mime: string;
  initUrl: string;
  segments: ManifestSegment[];
};

/** Dynamic timing information for an active live stream or a completed live DVR. */
export type LivePlaybackWindow = {
  active: boolean;
  postLiveDvr: boolean;
  headSequence: number;
  headTimeMs: number;
  seekableStartMs: number;
  seekableEndMs: number;
  atLiveEdge: boolean;
  targetLatencyMs: number;
};

/** Browser-ready tracks for the current playback window. */
export type PlaybackManifest = {
  durationMs: number;
  endOfStream: boolean;
  startTimeMs?: number;
  live?: LivePlaybackWindow | null;
  audio: ManifestTrack;
  video: ManifestTrack | null;
};
