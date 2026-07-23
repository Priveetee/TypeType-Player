type VisibilityTarget = EventTarget & {
  visibilityState?: DocumentVisibilityState;
};

type PlaybackLifecycleTargets = {
  document?: VisibilityTarget;
  video: EventTarget;
};

export function observePlaybackLifecycle(
  wake: () => void,
  targets: PlaybackLifecycleTargets,
): () => void {
  let pictureInPicture = false;
  const hidden = () => targets.document?.visibilityState === "hidden";
  const onEnterPictureInPicture = () => {
    pictureInPicture = true;
    wake();
  };
  const onLeavePictureInPicture = () => {
    pictureInPicture = false;
    wake();
  };
  const onMediaProgress = () => {
    if (pictureInPicture || hidden()) wake();
  };

  targets.video.addEventListener("enterpictureinpicture", onEnterPictureInPicture);
  targets.video.addEventListener("leavepictureinpicture", onLeavePictureInPicture);
  targets.video.addEventListener("timeupdate", onMediaProgress);
  targets.video.addEventListener("waiting", wake);
  targets.video.addEventListener("stalled", wake);
  targets.document?.addEventListener("visibilitychange", wake);
  targets.document?.addEventListener("resume", wake);

  return () => {
    targets.video.removeEventListener("enterpictureinpicture", onEnterPictureInPicture);
    targets.video.removeEventListener("leavepictureinpicture", onLeavePictureInPicture);
    targets.video.removeEventListener("timeupdate", onMediaProgress);
    targets.video.removeEventListener("waiting", wake);
    targets.video.removeEventListener("stalled", wake);
    targets.document?.removeEventListener("visibilitychange", wake);
    targets.document?.removeEventListener("resume", wake);
  };
}

export function browserPlaybackLifecycleTargets(video: HTMLVideoElement): PlaybackLifecycleTargets {
  return {
    video,
    ...(typeof document === "undefined" ? {} : { document }),
  };
}
