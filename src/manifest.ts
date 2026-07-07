import type { TrackKind } from "./types";

export type ManifestSegment = {
  url: string;
  startMs: number;
  durationMs: number;
};

export type ManifestTrack = {
  kind: TrackKind;
  mime: string;
  initUrl: string;
  segments: ManifestSegment[];
};

export type PlaybackManifest = {
  durationMs: number;
  audio: ManifestTrack;
  video: ManifestTrack;
};

function attributes(input: string): Map<string, string> {
  const result = new Map<string, string>();
  const regex = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let match = regex.exec(input);
  while (match) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) result.set(key, value);
    match = regex.exec(input);
  }
  return result;
}

function durationMs(value: string | null): number {
  if (!value) return 0;
  const match = /^PT([0-9]+(?:\.[0-9]+)?)S$/.exec(value);
  const seconds = match?.[1] ? Number(match[1]) : 0;
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

function resolveUrl(baseUrl: string, url: string): string {
  return new URL(url, baseUrl).href;
}

function parseTimeline(body: string): { startMs: number; durationMs: number }[] {
  const timeline: { startMs: number; durationMs: number }[] = [];
  const regex = /<S\b([^>]*)\/>/g;
  let match = regex.exec(body);
  while (match) {
    const attrs = attributes(match[1] ?? "");
    const startMs = Number(attrs.get("t") ?? "0");
    const segmentDurationMs = Number(attrs.get("d") ?? "0");
    timeline.push({
      startMs: Number.isFinite(startMs) ? startMs : 0,
      durationMs: Number.isFinite(segmentDurationMs) ? segmentDurationMs : 0,
    });
    match = regex.exec(body);
  }
  return timeline;
}

function parseTrack(
  kind: TrackKind,
  attrsText: string,
  body: string,
  baseUrl: string,
): ManifestTrack {
  const adaptationAttrs = attributes(attrsText);
  const representation = /<Representation\b([^>]*)>/.exec(body);
  const representationAttrs = attributes(representation?.[1] ?? "");
  const codecs = representationAttrs.get("codecs") ?? "";
  const container = adaptationAttrs.get("mimeType") ?? "video/mp4";
  const mime = codecs ? `${container}; codecs="${codecs}"` : container;
  const initMatch = /<Initialization\b([^>]*)\/>/.exec(body);
  const initUrl = attributes(initMatch?.[1] ?? "").get("sourceURL");
  if (!initUrl) throw new Error(`Missing ${kind} initialization URL`);
  const timeline = parseTimeline(body);
  const segments: ManifestSegment[] = [];
  const segmentRegex = /<SegmentURL\b([^>]*)\/>/g;
  let index = 0;
  let match = segmentRegex.exec(body);
  while (match) {
    const media = attributes(match[1] ?? "").get("media");
    const timing = timeline[index];
    if (media && timing) segments.push({ url: resolveUrl(baseUrl, media), ...timing });
    index += 1;
    match = segmentRegex.exec(body);
  }
  return { kind, mime, initUrl: resolveUrl(baseUrl, initUrl), segments };
}

export function parsePlaybackManifest(xml: string, baseUrl: string): PlaybackManifest {
  const duration = /mediaPresentationDuration="([^"]+)"/.exec(xml)?.[1] ?? null;
  const tracks = new Map<TrackKind, ManifestTrack>();
  const regex = /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/g;
  let match = regex.exec(xml);
  while (match) {
    const attrs = attributes(match[1] ?? "");
    const mimeType = attrs.get("mimeType") ?? "";
    const kind: TrackKind = mimeType.startsWith("audio/") ? "audio" : "video";
    tracks.set(kind, parseTrack(kind, match[1] ?? "", match[2] ?? "", baseUrl));
    match = regex.exec(xml);
  }
  const audio = tracks.get("audio");
  const video = tracks.get("video");
  if (!audio || !video) throw new Error("Manifest must contain audio and video tracks");
  return { durationMs: durationMs(duration), audio, video };
}
