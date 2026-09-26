import { describe, it, expect } from "vitest";
import { buildUrl, godaddyRequest, GodaddyApiError } from "../src/client.ts";
import type { GodaddyConfig } from "../src/config.ts";
import { mockFetch, resultJson, resultSummary } from "./helpers.ts";

const config: GodaddyConfig = { pat: "test-pat", baseUrl: "https://api.test.com" };

describe("buildUrl", () => {
  it("omits undefined query params and stringifies the rest", () => {
    expect(buildUrl("https://api.test.com", "/v3/x", { a: "1", b: undefined, c: 5, d: true })).toBe(
      "https://api.test.com/v3/x?a=1&c=5&d=true",
    );
  });

  it("encodes query values", () => {
    expect(buildUrl("https://api.test.com", "/v3/x", { q: "a b,c" })).toBe(
      "https://api.test.com/v3/x?q=a+b%2Cc",
    );
  });
});

describe("godaddyRequest", () => {
  it("sends Bearer auth, Accept, and query params", async () => {
    const { calls, restore } = mockFetch(() => ({ body: { ok: true } }));
    const result = await godaddyRequest<{ ok: boolean }>(config, "/v3/domains/domain-names", {
      query: { pageSize: 5 },
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://api.test.com/v3/domains/domain-names?pageSize=5");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-pat");
    expect(headers.Accept).toBe("application/json");
    restore();
  });

  it("sends JSON body with Content-Type on POST", async () => {
    const { calls, restore } = mockFetch(() => ({ body: {} }));
    await godaddyRequest(config, "/v3/domains/registration-quotes", {
      method: "POST",
      body: { domain: "example.com", period: 1 },
    });
    const init = calls[0].init;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ domain: "example.com", period: 1 }));
    restore();
  });

  it("returns undefined for 204 No Content", async () => {
    const { restore } = mockFetch(() => ({ status: 204 }));
    await expect(godaddyRequest(config, "/v3/x")).resolves.toBeUndefined();
    restore();
  });

  it("parses GoDaddy error envelopes into GodaddyApiError", async () => {
    const { restore } = mockFetch(() => ({
      status: 422,
      body: {
        status: 422,
        code: "QUOTE_MISMATCH",
        message: "The period does not match the quote",
        fields: [{ name: "period", message: "must equal the quoted period" }],
      },
    }));
    const err = await godaddyRequest(config, "/v3/x").catch((e) => e);
    expect(err).toBeInstanceOf(GodaddyApiError);
    const apiErr = err as GodaddyApiError;
    expect(apiErr.status).toBe(422);
    expect(apiErr.code).toBe("QUOTE_MISMATCH");
    expect(apiErr.detail).toContain("QUOTE_MISMATCH");
    expect(apiErr.detail).toContain("period: must equal the quoted period");
    restore();
  });

  it("parses field-level details from the details[] array (validation errors)", async () => {
    const { restore } = mockFetch(() => ({
      status: 422,
      body: {
        correlationId: "abc",
        message: "Request failed validation",
        name: "VALIDATION_ERROR",
        details: [
          {
            description: "Does not match pattern '^[ -~]+$'",
            field: "shopper:address/city",
            issue: "MISMATCH_FORMAT",
          },
        ],
      },
    }));
    const err = await godaddyRequest(config, "/v3/x").catch((e) => e);
    const apiErr = err as GodaddyApiError;
    expect(apiErr.code).toBe("VALIDATION_ERROR");
    expect(apiErr.fields).toEqual([
      { name: "shopper:address/city", code: "MISMATCH_FORMAT", message: "Does not match pattern '^[ -~]+$'" },
    ]);
    expect(apiErr.detail).toContain("shopper:address/city: Does not match pattern");
    restore();
  });

  it("uses the error name as code when code is absent (bulk availability)", async () => {
    const { restore } = mockFetch(() => ({
      status: 400,
      body: { name: "MISMATCH_FORMAT", message: "not a valid domain" },
    }));
    const err = await godaddyRequest(config, "/v3/x").catch((e) => e);
    expect((err as GodaddyApiError).code).toBe("MISMATCH_FORMAT");
    restore();
  });

  it("reads Retry-After from the response header on 429", async () => {
    const { restore } = mockFetch(() => ({
      status: 429,
      headers: { "Retry-After": "30" },
      body: { status: 429, message: "rate limited" },
    }));
    const err = await godaddyRequest(config, "/v3/x").catch((e) => e);
    expect((err as GodaddyApiError).retryAfterSec).toBe(30);
    expect((err as GodaddyApiError).detail).toContain("retry after 30s");
    restore();
  });

  it("wraps network failures", async () => {
    const { restore } = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = await godaddyRequest(config, "/v3/x").catch((e) => e);
    expect(err).toBeInstanceOf(GodaddyApiError);
    expect((err as GodaddyApiError).detail).toContain("fetch failed");
    restore();
  });
});

describe("result helpers", () => {
  it("split summary and json", () => {
    const text = "Some summary\n\n{\"a\":1}";
    expect(resultSummary(text)).toBe("Some summary");
    expect(resultJson(text)).toEqual({ a: 1 });
  });
});
