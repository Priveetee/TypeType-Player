import { TypeTypeMsePlayer } from "../src";

const video = document.querySelector<HTMLVideoElement>("#player");

if (!video) throw new Error("Missing video element");

const engine = new TypeTypeMsePlayer(video, {
  endpoint: "http://localhost:8080/api",
  videoId: "VIDEO_ID",
  videoItag: 137,
  audioItag: 140,
  audioTrackId: null,
});

engine.on("state", (event) => console.log(event));
engine.on("manifest", (event) => console.log(event));
engine.on("buffer", (event) => console.log(event));
engine.on("error", (event) => console.error(event.error));

await engine.load();
