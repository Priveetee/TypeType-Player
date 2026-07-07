# TypeType MSE

TypeType MSE is a browser-side Media Source Extensions engine for TypeType SABR playback.

The library owns the media source pipeline and leaves UI controls to Vidstack or any other shell around the same `HTMLVideoElement`.

## Scope

- TypeScript strict library
- Bun package and CI
- No runtime dependencies
- Backend playback-session API client
- DASH `SegmentList` manifest reader for TypeType SABR sessions
- MSE append queues for audio and video source buffers
- Explicit startup, buffer fill, seek, and destroy lifecycle
- Abort-safe seek coalescing
- Bounded forward buffer and back-buffer trimming
- Native media element event observation for state diagnostics
- Runtime snapshots for TypeType integration probes

## Usage

```ts
import { TypeTypeMsePlayer } from "@typetype/mse";

const engine = new TypeTypeMsePlayer(videoElement, {
  endpoint: "https://beta.typetype.video/api",
  videoId: "VIDEO_ID",
  videoItag: 137,
  audioItag: 140,
  audioTrackId: null,
  startTimeMs: 0,
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

engine.on("state", (event) => console.log(event.state));
await engine.load();
await engine.play();

await engine.setQuality({ videoItag: 248 });
```

## Diagnostics

```ts
const snapshot = engine.snapshot();

engine.on("buffer", (event) => {
  console.log(event.currentTimeMs, event.bufferedEndMs);
});
```

## Integration Model

```text
Vidstack UI
HTMLVideoElement
TypeType MSE engine
TypeType SABR playback-session API
```
