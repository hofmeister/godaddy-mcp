import { describe, it, expect } from "vitest";
import {
  runCheckDomainAvailability,
  runSuggestDomains,
} from "../src/tools/search.js";
import type { GodaddyConfig } from "../src/config.js";
import { mockFetch, resultJson, resultSummary } from "./helpers.js";

const config: GodaddyConfig = { pat: "test-pat", baseUrl: "https://api.test.com" };

describe("runCheckDomainAvailability", () => {
  it("uses GET with query params for a single domain", async () => {
    const { calls, restore } = mockFetch(() => ({
      body: {
        domain: "idea.com",
        available: true,
        definitive: false,
        prices: [
          {
            term: "YEAR",
            period: 1,
            price: { currencyCode: "USD", value: 1199 },
            renewalPrice: { currencyCode: "USD", value: 2299 },
          },
          {
            term: "YEAR",
            period: 2,
            price: { currencyCode: "USD", value: 3098 },
            firstTermPrice: { currencyCode: "USD", value: 799 },
            recommended: true,
          },
        ],
      },
    }));
    const res = await runCheckDomainAvailability(
      { domains: ["idea.com"], optimizeFor: "ACCURACY" },
      config,
    );
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v3/domains/check-availability");
    expect(url.searchParams.get("domain")).toBe("idea.com");
    expect(url.searchParams.get("optimizeFor")).toBe("ACCURACY");
    expect(calls[0].init.method).toBe("GET");

    const json = resultJson(res.content[0]!.text);
    const item = json.results[0] as Record<string, any>;
    expect(item.available).toBe(true);
    expect(item.prices[0].price).toBe("11.99 USD");
    expect(item.prices[0].renewal).toBe("22.99 USD");
    expect(item.prices[1].firstTermPrice).toBe("7.99 USD");
    expect(item.prices[1].recommended).toBe(true);
    expect(resultSummary(res.content[0]!.text)).toContain("1 of 1");
    restore();
  });

  it("uses POST for bulk checks and preserves order", async () => {
    const { calls, restore } = mockFetch(() => ({
      body: {
        items: [
          { domain: "a.com", available: true, prices: [] },
          {
            domain: "b.com",
            error: { name: "MISMATCH_FORMAT", message: "does not conform" },
          },
        ],
      },
    }));
    const res = await runCheckDomainAvailability({ domains: ["a.com", "b.com"] }, config);
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ domains: ["a.com", "b.com"], optimizeFor: undefined, iscCode: undefined });

    const json = resultJson(res.content[0]!.text);
    const results = json.results as Array<Record<string, unknown>>;
    expect(results[0].available).toBe(true);
    expect(results[1]).toEqual({
      domain: "b.com",
      available: false,
      error: "does not conform",
    });
    expect(resultSummary(res.content[0]!.text)).toContain("1 of 2");
    restore();
  });
});

describe("runSuggestDomains", () => {
  it("maps query params and formats suggestion prices", async () => {
    const { calls, restore } = mockFetch(() => ({
      body: {
        items: [
          {
            domain: "sunrisebakery.com",
            inventory: "REGISTRY",
            prices: [
              {
                term: "YEAR",
                period: 1,
                price: { currencyCode: "USD", value: 1299 },
                renewalPrice: { currencyCode: "USD", value: 2299 },
              },
            ],
          },
        ],
      },
    }));
    const res = await runSuggestDomains(
      {
        query: "sunrise bakery",
        tlds: ["com", "net"],
        pageSize: 5,
        sources: ["EXTENSION", "PREMIUM"],
      },
      config,
    );
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v3/domains/suggestions");
    expect(url.searchParams.get("query")).toBe("sunrise bakery");
    expect(url.searchParams.get("tlds")).toBe("com,net");
    expect(url.searchParams.get("pageSize")).toBe("5");
    expect(url.searchParams.get("sources")).toBe("EXTENSION,PREMIUM");

    const json = resultJson(res.content[0]!.text);
    const suggestion = json.suggestions[0] as Record<string, any>;
    expect(suggestion.domain).toBe("sunrisebakery.com");
    expect(suggestion.prices[0].price).toBe("12.99 USD");
    restore();
  });
});
