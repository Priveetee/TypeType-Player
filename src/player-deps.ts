import { resolveBufferPolicy } from "./buffer-policy";
import type { EventEmitter } from "./event-emitter";
import { HttpClient } from "./http-client";
import { MediaElementObserver } from "./media-element-observer";
import { MediaSourceController } from "./media-source-controller";
import { PlaybackClient } from "./playback-client";
import { PlaybackLoop } from "./playback-loop";
import { bufferedEndMs } from "./player-snapshot";
import { SegmentScheduler } from "./segment-scheduler";
import type { LoadedSession } from "./session-loader";
import type { TypeTypeMseConfig, TypeTypeMseState } from "./types";

export type PlayerDeps = {
  http: HttpClient;
  playback: PlaybackClient;
  mediaEvents: MediaElementObserver;
  media: MediaSourceController;
  scheduler: SegmentScheduler;
  loop: PlaybackLoop;
};

type Args = {
  video: HTMLVideoElement;
  config: TypeTypeMseConfig;
  emitter: EventEmitter;
  session: () => LoadedSession | null;
  signal: () => AbortSignal;
  state: (state: TypeTypeMseState) => void;
  error: (error: Error) => void;
};

export function createPlayerDeps(args: Args): PlayerDeps {
  const http = new HttpClient(
    args.config.headers
      ? { endpoint: args.config.endpoint, headers: args.config.headers }
      : { endpoint: args.config.endpoint },
  );
  const playback = new PlaybackClient(http);
  const mediaEvents = new MediaElementObserver({
    video: args.video,
    state: args.state,
    error: args.error,
  });
  const media = new MediaSourceController(args.video);
  const scheduler = new SegmentScheduler(http, media, args.emitter);
  const loop = new PlaybackLoop({
    video: args.video,
    http,
    media,
    scheduler,
    emitter: args.emitter,
    policy: resolveBufferPolicy(args.config),
    session: args.session,
    signal: args.signal,
    bufferedEndMs: () => bufferedEndMs(args.video),
    error: args.error,
  });
  return { http, playback, mediaEvents, media, scheduler, loop };
}
