import { describe, it, expect } from "vitest";
import { runListDomains, runGetDomain, runRenewDomain } from "../src/tools/domains.js";
import type { GodaddyConfig } from "../src/config.js";
import { mockFetch, resultJson, resultSummary } from "./helpers.js";

const config: GodaddyConfig = { pat: "test-pat", baseUrl: "https://api.test.com" };

describe("runListDomains", () => {
  it("maps filters to query params", async () => {
    const { calls, restore } = mockFetch(() => ({ body: { items: [], links: [] } }));
    await runListDomains(
      {
        statuses: ["active"],
        expiresBefore: "2027-01-01T00:00:00Z",
        pageSize: 50,
        pageToken: "tok",
      },
      config,
    );
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v3/domains/domain-names");
    expect(url.searchParams.get("statuses")).toBe("ACTIVE");
    expect(url.searchParams.get("expiresBefore")).toBe("2027-01-01T00:00:00Z");
    expect(url.searchParams.get("pageSize")).toBe("50");
    expect(url.searchParams.get("pageToken")).toBe("tok");
    expect(url.searchParams.has("lifecycleGroups")).toBe(false);
    restore();
  });

  it("returns compact domains and surfaces the next-page link", async () => {
    const { restore } = mockFetch(() => ({
      body: {
        items: [
          {
            domain: "example.com",
            status: "ACTIVE",
            expiresAt: "2027-06-12T10:02:10Z",
            renewBy: "2027-05-20T00:00:00Z",
            autoRenew: true,
            privacy: false,
            transferLock: true,
            nameServers: ["ns01.domaincontrol.com"],
          },
        ],
        links: [{ rel: "next", href: "/v3/domains/domain-names?pageToken=abc" }],
      },
    }));
    const res = await runListDomains({}, config);
    expect(res.isError).toBeUndefined();
    const json = resultJson(res.content[0]!.text);
    const domain = json.domains[0] as Record<string, unknown>;
    expect(domain).toMatchObject({
      domain: "example.com",
      status: "ACTIVE",
      expiresAt: "2027-06-12T10:02:10Z",
      autoRenew: true,
    });
    expect(json.next).toBe("/v3/domains/domain-names?pageToken=abc");
    expect(resultSummary(res.content[0]!.text)).toContain("1 domain(s)");
    restore();
  });
});

describe("runGetDomain", () => {
  it("requests the domain resource and summarizes renew state", async () => {
    const { calls, restore } = mockFetch(() => ({
      body: {
        domain: "example.com",
        status: "ACTIVE",
        expiresAt: "2027-06-12T10:02:10Z",
        renewBy: "2027-05-20T00:00:00Z",
        autoRenew: false,
        privacy: true,
        transferLock: false,
        nameServers: ["ns01.domaincontrol.com", "ns02.domaincontrol.com"],
      },
    }));
    const res = await runGetDomain({ domain: "example.com" }, config);
    expect(calls[0].url).toBe("https://api.test.com/v3/domains/domain-names/example.com");
    const summary = resultSummary(res.content[0]!.text);
    expect(summary).toContain("auto-renew OFF");
    expect(summary).toContain("renew by 2027-05-20T00:00:00Z");
    restore();
  });

  it("URL-encodes the domain", async () => {
    const { calls, restore } = mockFetch(() => ({
      body: { domain: "xn--exmple.com", status: "ACTIVE", expiresAt: "2027-01-01T00:00:00Z", autoRenew: true, privacy: false },
    }));
    await runGetDomain({ domain: "xn--exmple.com" }, config);
    expect(calls[0].url).toContain("/v3/domains/domain-names/xn--exmple.com");
    restore();
  });
});

describe("runRenewDomain", () => {
  it("posts the renewal and reports the order", async () => {
    const { calls, restore } = mockFetch(() => ({
      status: 200,
      body: { orderId: 424242, itemCount: 1, total: 2299, currency: "USD" },
    }));
    const res = await runRenewDomain({ domain: "example.com", period: 2 }, config);
    expect(calls[0].url).toBe("https://api.test.com/v1/domains/example.com/renew");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify({ period: 2 }));
    const json = resultJson(res.content[0]!.text);
    expect(json.orderId).toBe(424242);
    expect(json.total).toBe("22.99 USD");
    expect(resultSummary(res.content[0]!.text)).toContain("Renewal order 424242");
    restore();
  });

  it("defaults the renewal period to 1", async () => {
    const { calls, restore } = mockFetch(() => ({
      body: { orderId: 1, itemCount: 1, total: 1199, currency: "USD" },
    }));
    await runRenewDomain({ domain: "example.com" }, config);
    expect(calls[0].init.body).toBe(JSON.stringify({ period: 1 }));
    restore();
  });
});
