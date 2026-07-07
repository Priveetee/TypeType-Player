import type { HttpClient } from "./http-client";

export async function waitForManifest(
  http: HttpClient,
  url: string,
  retryAfterMs: number,
  signal?: AbortSignal,
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError");
    const response = await http.response(url, signal ? { signal } : undefined);
    if (response.status === 200) return response.text();
    if (response.status !== 202) throw new Error(`Manifest failed with ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  }
  throw new Error("Manifest was not ready in time");
}
