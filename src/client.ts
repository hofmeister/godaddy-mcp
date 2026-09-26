import type { GodaddyConfig } from "./config.ts";

export interface ApiFieldError {
  name?: string;
  code?: string;
  message?: string;
}

export class GodaddyApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly fields?: ApiFieldError[];
  readonly retryAfterSec?: number;

  constructor(
    status: number,
    message: string,
    code?: string,
    fields?: ApiFieldError[],
    retryAfterSec?: number,
  ) {
    super(message);
    this.name = "GodaddyApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfterSec = retryAfterSec;
  }

  get detail(): string {
    let out = `GoDaddy API error ${this.status}: ${this.message}`;
    if (this.code) {
      out += ` [code=${this.code}]`;
    }
    if (this.fields && this.fields.length > 0) {
      const parts = this.fields.map(
        (f) => `${f.name ?? "?"}: ${f.message ?? f.code ?? "invalid"}`,
      );
      out += `; fields: ${parts.join("; ")}`;
    }
    if (this.retryAfterSec !== undefined) {
      out += ` (rate limited; retry after ${this.retryAfterSec}s)`;
    }
    return out;
  }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface Paged<T> {
  items: T[];
  totalItems?: number;
  totalPages?: number;
  links?: Array<{ rel: string; href: string }>;
}

export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(baseUrl + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function parseRetryAfter(
  res: Response,
  envelope: Record<string, unknown> | null,
): number | undefined {
  const header = res.headers.get("Retry-After");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return seconds;
    }
  }
  const body = (envelope?.retryAfterSec ?? envelope?.retry_after_sec) as number | undefined;
  return typeof body === "number" ? body : undefined;
}

export async function godaddyRequest<T>(
  config: GodaddyConfig,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", query, body, headers = {}, signal } = options;

  let res: Response;
  try {
    res = await fetch(buildUrl(config.baseUrl, path, query), {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${config.pat}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GodaddyApiError(0, `network request failed: ${message}`);
  }

  if (!res.ok) {
    let envelope: Record<string, unknown> | null = null;
    try {
      const text = await res.text();
      if (text) {
        envelope = JSON.parse(text) as Record<string, unknown>;
      }
    } catch {
      // Non-JSON error body; keep envelope null.
    }
    const message =
      typeof envelope?.message === "string" && envelope.message
        ? envelope.message
        : res.statusText || `HTTP ${res.status}`;
    const code =
      typeof envelope?.code === "string"
        ? envelope.code
        : typeof envelope?.name === "string"
          ? envelope.name
          : undefined;
    const rawFields = Array.isArray(envelope?.fields)
      ? (envelope?.fields as unknown[])
      : Array.isArray(envelope?.details)
        ? (envelope?.details as unknown[])
        : undefined;
    const fields = rawFields?.map((raw) => {
      const f = raw as Record<string, unknown>;
      return {
        name: typeof f.name === "string" ? f.name : typeof f.field === "string" ? f.field : undefined,
        code: typeof f.code === "string" ? f.code : typeof f.issue === "string" ? f.issue : undefined,
        message:
          typeof f.message === "string" ? f.message : typeof f.description === "string" ? f.description : undefined,
      };
    });
    throw new GodaddyApiError(
      res.status,
      message,
      code,
      fields,
      parseRetryAfter(res, envelope),
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export interface PollOutcome<T> {
  resource: T;
  timedOut: boolean;
}

/**
 * Poll a resource at `path` until its `status` reaches COMPLETED or FAILED,
 * or until the timeout elapses.
 */
export async function pollResource<T extends { status?: string }>(
  config: GodaddyConfig,
  path: string,
  options: PollOptions = {},
): Promise<PollOutcome<T>> {
  const { intervalMs = 3000, timeoutMs = 90_000 } = options;
  const deadline = Date.now() + timeoutMs;
  let resource: T;
  for (;;) {
    resource = await godaddyRequest<T>(config, path);
    if (resource.status === "COMPLETED" || resource.status === "FAILED") {
      return { resource, timedOut: false };
    }
    if (Date.now() + intervalMs > deadline) {
      return { resource, timedOut: true };
    }
    await sleep(intervalMs);
  }
}
