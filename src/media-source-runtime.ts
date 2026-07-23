export type CreatedMediaSource = {
  managed: boolean;
  mediaSource: MediaSource;
};

type MediaSourceConstructor = {
  new (): MediaSource;
  isTypeSupported: (mime: string) => boolean;
};

export type MediaSourceRuntimeScope = {
  ManagedMediaSource?: MediaSourceConstructor;
  MediaSource?: MediaSourceConstructor;
};

export function createMediaSource(
  scope: MediaSourceRuntimeScope = globalThis as MediaSourceRuntimeScope,
): CreatedMediaSource {
  const runtime = resolveMediaSourceRuntime(scope);
  if (!runtime) throw new Error("Media Source Extensions are not available");
  return { managed: runtime.managed, mediaSource: new runtime.constructor() };
}

/** Checks whether the preferred browser MSE runtime supports a MIME type. */
export function isMseTypeSupported(mime: string): boolean {
  return isMseTypeSupportedForScope(mime, globalThis as MediaSourceRuntimeScope);
}

export function isMseTypeSupportedForScope(
  mime: string,
  scope: MediaSourceRuntimeScope = globalThis as MediaSourceRuntimeScope,
): boolean {
  return resolveMediaSourceRuntime(scope)?.constructor.isTypeSupported(mime) === true;
}

function resolveMediaSourceRuntime(scope: MediaSourceRuntimeScope): {
  constructor: MediaSourceConstructor;
  managed: boolean;
} | null {
  if (scope.ManagedMediaSource) {
    return { constructor: scope.ManagedMediaSource, managed: true };
  }
  if (scope.MediaSource) {
    return { constructor: scope.MediaSource, managed: false };
  }
  return null;
}
