import { afterEach, expect, test } from "bun:test";
import { HttpClient } from "../src/http-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("preserves endpoint path for absolute API URLs", () => {
  const http = new HttpClient({ endpoint: "https://beta.typetype.video/api" });
  expect(http.absolute("/sabr/playback/session/manifest")).toBe(
    "https://beta.typetype.video/api/sabr/playback/session/manifest",
  );
});

test("retries transient gateway responses", async () => {
  let requests = 0;
  globalThis.fetch = () => {
    requests += 1;
    if (requests < 3) {
      return Promise.resolve(new Response(null, { status: 502, headers: { "retry-after": "0" } }));
    }
    return Promise.resolve(Response.json({ ready: true }));
  };

  const result = await new HttpClient({ endpoint: "https://example.test/api" }).json("/window");

  expect(result).toEqual({ ready: true });
  expect(requests).toBe(3);
});

test("does not retry permanent client errors", async () => {
  let requests = 0;
  globalThis.fetch = () => {
    requests += 1;
    return Promise.resolve(new Response(null, { status: 400, statusText: "Bad Request" }));
  };

  await expect(
    new HttpClient({ endpoint: "https://example.test/api" }).json("/window"),
  ).rejects.toMatchObject({ status: 400 });
  expect(requests).toBe(1);
});

test("returns permanent segment errors to the caller", async () => {
  globalThis.fetch = () => Promise.resolve(new Response(null, { status: 404 }));

  const response = await new HttpClient({ endpoint: "https://example.test/api" }).response(
    "https://example.test/segment",
  );

  expect(response.status).toBe(404);
});

test("bounds transient gateway retries", async () => {
  let requests = 0;
  globalThis.fetch = () => {
    requests += 1;
    return Promise.resolve(new Response(null, { status: 503, headers: { "retry-after": "0" } }));
  };

  await expect(
    new HttpClient({ endpoint: "https://example.test/api" }).json("/window"),
  ).rejects.toMatchObject({ status: 503 });
  expect(requests).toBe(25);
});

test("aborts a pending transient retry", async () => {
  const controller = new AbortController();
  globalThis.fetch = () =>
    Promise.resolve(new Response(null, { status: 503, headers: { "retry-after": "3" } }));
  const request = new HttpClient({ endpoint: "https://example.test/api" }).json("/window", {
    signal: controller.signal,
  });

  controller.abort();

  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});
