import type { HttpClient } from "./http-client";
import { type PlaybackManifest, parsePlaybackManifest } from "./manifest";
import { waitForManifest } from "./manifest-loader";
import { MediaSourceController } from "./media-source-controller";
import type { PlaybackClient, PlaybackResponse } from "./playback-client";
import type { SegmentScheduler } from "./segment-scheduler";

export type LoadedSession = {
  response: PlaybackResponse;
  manifestUrl: string;
  manifest: PlaybackManifest;
};

type LoadSessionArgs = {
  http: HttpClient;
  playback: PlaybackClient;
  media: MediaSourceController;
  scheduler: SegmentScheduler;
  video: HTMLVideoElement;
  response: PlaybackResponse;
  startTimeMs: number;
  signal: AbortSignal;
};

export async function loadPlaybackSession(args: LoadSessionArgs): Promise<LoadedSession> {
  const manifestUrl = args.playback.manifestUrl(args.response);
  const xml = await waitForManifest(
    args.http,
    manifestUrl,
    args.response.retryAfterMs ?? 500,
    args.signal,
  );
  const manifest = parsePlaybackManifest(xml, manifestUrl);
  if (!MediaSourceController.supported(manifest)) throw new Error("MSE codecs are not supported");
  args.scheduler.reset();
  await args.media.attach(manifest);
  if (args.startTimeMs > 0) args.video.currentTime = args.startTimeMs / 1000;
  await args.scheduler.appendInit(manifest, args.signal);
  return { response: args.response, manifestUrl, manifest };
}

export async function refreshSessionManifest(
  http: HttpClient,
  session: LoadedSession,
  signal: AbortSignal,
): Promise<void> {
  const xml = await waitForManifest(http, session.manifestUrl, 500, signal);
  session.manifest = parsePlaybackManifest(xml, session.manifestUrl);
}
