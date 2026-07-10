# TypeType Player

TypeType Player is the browser-side Media Source Extensions engine for TypeType SABR playback.

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

```sh
npm install @typetype/mse
```

The same source is also distributed through JSR:

```sh
bunx jsr add @typetype/mse
```

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

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run check:jsr
bun test
bun run build
```

Releases are published to npm and JSR from `vX.Y.Z` tags through trusted publishing. The release workflow uses GitHub OIDC and does not store registry tokens.
