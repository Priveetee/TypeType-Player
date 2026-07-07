import type { HttpClient } from "./http-client";

export type PlaybackResponse = {
  sessionId: string;
  videoId: string;
  manifestUrl: string | null;
  generation: number | null;
  ready: boolean;
  retryAfterMs: number | null;
};

export type CreatePlaybackRequest = {
  videoId: string;
  videoItag: number;
  audioItag: number;
  audioTrackId: string | null;
  startTimeMs: number;
};

function field(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function stringField(value: object, key: string): string | null {
  const result = field(value, key);
  return typeof result === "string" && result.length > 0 ? result : null;
}

function numberField(value: object, key: string): number | null {
  const result = field(value, key);
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}

function parsePlaybackResponse(value: unknown): PlaybackResponse {
  if (!value || typeof value !== "object") throw new Error("Invalid playback response");
  const sessionId = stringField(value, "sessionId");
  const videoId = stringField(value, "videoId");
  if (!sessionId || !videoId) throw new Error("Invalid playback response");
  return {
    sessionId,
    videoId,
    manifestUrl: stringField(value, "manifestUrl"),
    generation: numberField(value, "generation"),
    ready: field(value, "ready") === true,
    retryAfterMs: numberField(value, "retryAfterMs"),
  };
}

export class PlaybackClient {
  constructor(private readonly http: HttpClient) {}

  async create(request: CreatePlaybackRequest, signal?: AbortSignal): Promise<PlaybackResponse> {
    const params = new URLSearchParams({
      videoItag: String(request.videoItag),
      audioItag: String(request.audioItag),
      startTimeMs: String(request.startTimeMs),
    });
    if (request.audioTrackId) params.set("audioTrackId", request.audioTrackId);
    const videoId = encodeURIComponent(request.videoId);
    const init = signal ? { method: "POST", signal } : { method: "POST" };
    const response = await this.http.json(`/sabr/playback/${videoId}?${params}`, init);
    return parsePlaybackResponse(response);
  }

  async seek(
    sessionId: string,
    positionMs: number,
    signal?: AbortSignal,
  ): Promise<PlaybackResponse> {
    const session = encodeURIComponent(sessionId);
    const params = new URLSearchParams({
      playerTimeMs: String(Math.max(0, Math.round(positionMs))),
    });
    const init = signal ? { method: "POST", signal } : { method: "POST" };
    const response = await this.http.json(`/sabr/playback/${session}/seek?${params}`, init);
    return parsePlaybackResponse(response);
  }

  manifestUrl(response: PlaybackResponse): string {
    const path =
      response.manifestUrl ?? `/sabr/playback/${encodeURIComponent(response.sessionId)}/manifest`;
    const url = new URL(this.http.absolute(path));
    if (response.generation !== null)
      url.searchParams.set("generation", String(response.generation));
    return url.href;
  }
}
