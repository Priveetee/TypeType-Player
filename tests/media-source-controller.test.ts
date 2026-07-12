import { expect, test } from "bun:test";
import { MediaSourceController } from "../src/media-source-controller";

type ControllerState = {
  objectUrl: string | null;
};

function videoElement(src: string) {
  const calls: string[] = [];
  return {
    calls,
    video: {
      src,
      removeAttribute: (name: string) => calls.push(`remove:${name}`),
      load: () => calls.push("load"),
    } as unknown as HTMLVideoElement,
  };
}

test("detach releases the media source owned by the controller", () => {
  const { calls, video } = videoElement("blob:owned");
  const controller = new MediaSourceController(video);
  (controller as unknown as ControllerState).objectUrl = "blob:owned";

  controller.detach();

  expect(calls).toEqual(["remove:src", "load"]);
});

test("stale controller cannot detach a replacement media source", () => {
  const { calls, video } = videoElement("blob:replacement");
  const controller = new MediaSourceController(video);
  (controller as unknown as ControllerState).objectUrl = "blob:stale";

  controller.detach();

  expect(calls).toEqual([]);
  expect(video.src).toBe("blob:replacement");
});
