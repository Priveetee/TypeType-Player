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

/** Browser-ready tracks for the current playback window. */
export type PlaybackManifest = {
  durationMs: number;
  endOfStream: boolean;
  audio: ManifestTrack;
  video: ManifestTrack | null;
};
