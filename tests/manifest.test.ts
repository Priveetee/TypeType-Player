import { expect, test } from "bun:test";
import { parsePlaybackManifest } from "../src/manifest";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT120S">
  <Period>
    <AdaptationSet mimeType="video/mp4" startWithSAP="1">
      <Representation id="v" bandwidth="1" codecs="avc1.640028">
        <SegmentList timescale="1000">
          <Initialization sourceURL="/api/sabr/playback/session/137/init?generation=1"/>
          <SegmentTimeline><S t="0" d="5000"/><S t="5000" d="5000"/></SegmentTimeline>
          <SegmentURL media="/api/sabr/playback/session/137/segment/1?generation=1"/>
          <SegmentURL media="/api/sabr/playback/session/137/segment/2?generation=1"/>
        </SegmentList>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4">
      <Representation id="a" bandwidth="1" codecs="mp4a.40.2">
        <SegmentList timescale="1000">
          <Initialization sourceURL="/api/sabr/playback/session/140/init?generation=1"/>
          <SegmentTimeline><S t="0" d="5000"/></SegmentTimeline>
          <SegmentURL media="/api/sabr/playback/session/140/segment/1?generation=1"/>
        </SegmentList>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

test("parses TypeType playback manifests", () => {
  const manifest = parsePlaybackManifest(
    xml,
    "https://beta.typetype.video/api/sabr/playback/session/manifest",
  );
  expect(manifest.durationMs).toBe(120_000);
  expect(manifest.video.mime).toBe('video/mp4; codecs="avc1.640028"');
  expect(manifest.audio.mime).toBe('audio/mp4; codecs="mp4a.40.2"');
  expect(manifest.video.segments).toHaveLength(2);
  expect(manifest.audio.segments[0]?.url).toBe(
    "https://beta.typetype.video/api/sabr/playback/session/140/segment/1?generation=1",
  );
});
