import { vi } from "vitest";

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export type Responder = (call: RecordedCall, url: URL) => {
  status?: number;
  statusText?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * Stub global fetch with a queue of responders. Each call pops the next
 * responder (or keeps using the last one when the queue is exhausted).
 */
export function mockFetch(
  responders: Responder | Responder[],
): { calls: RecordedCall[]; restore: () => void } {
  const queue: Responder[] = Array.isArray(responders) ? [...responders] : [responders];
  const calls: RecordedCall[] = [];

  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const call: RecordedCall = { url: url.toString(), init: init ?? {} };
    calls.push(call);
    const responder = queue.length > 1 ? queue.shift()! : queue[0]!;
    const result = responder(call, url);
    const body =
      result.body === undefined
        ? null
        : typeof result.body === "string"
          ? result.body
          : JSON.stringify(result.body);
    const headers = new Headers(result.headers);
    if (body !== null && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new Response(body, {
      status: result.status ?? 200,
      statusText: result.statusText,
      headers,
    });
  });

  vi.stubGlobal("fetch", fn);
  return {
    calls,
    restore: () => {
      vi.unstubAllGlobals();
    },
  };
}

/** Extract the JSON payload from an okResult/errResult text body. */
export function resultJson(text: string): Record<string, unknown> {
  const idx = text.indexOf("\n\n");
  const json = idx === -1 ? text : text.slice(idx + 2);
  return JSON.parse(json) as Record<string, unknown>;
}

/** Extract the summary line from an okResult text body. */
export function resultSummary(text: string): string {
  const idx = text.indexOf("\n\n");
  return idx === -1 ? "" : text.slice(0, idx);
}
