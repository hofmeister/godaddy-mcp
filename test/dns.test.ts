import { describe, it, expect } from "vitest";
import {
  runListDnsRecords,
  runAddDnsRecord,
  runUpdateDnsRecord,
  runDeleteDnsRecord,
  validateDnsRecord,
  type DnsRecordInput,
} from "../src/tools/dns.js";
import type { GodaddyConfig } from "../src/config.js";
import { mockFetch, resultJson, resultSummary } from "./helpers.js";

const config: GodaddyConfig = { pat: "test-pat", baseUrl: "https://api.test.com" };

function validRecord(overrides: Partial<DnsRecordInput> = {}): DnsRecordInput {
  return {
    type: "A",
    name: "www",
    data: "93.184.216.34",
    ttl: 3600,
    ...overrides,
  };
}

describe("validateDnsRecord", () => {
  it("accepts a normal A record", () => {
    expect(validateDnsRecord(validRecord())).toEqual([]);
  });

  it("rejects SOA writes", () => {
    expect(validateDnsRecord(validRecord({ type: "SOA" }))).toEqual([
      "SOA records are managed by GoDaddy and cannot be created or modified.",
    ]);
  });

  it("rejects apex NS changes", () => {
    expect(validateDnsRecord(validRecord({ type: "NS", name: "@" }))).toEqual([
      "The zone's authoritative NS set is managed by GoDaddy; use set_nameservers instead.",
    ]);
  });

  it("rejects CNAME at the apex", () => {
    expect(validateDnsRecord(validRecord({ type: "CNAME", name: "@" }))).toEqual([
      "CNAME records are not allowed at the zone apex (@).",
    ]);
  });

  it("rejects wildcards for non-wildcard types", () => {
    expect(validateDnsRecord(validRecord({ name: "*", type: "TXT" }))).toEqual([
      "Wildcard (*) records are only supported for A, AAAA, and CNAME.",
    ]);
  });

  it("allows wildcards for A/AAAA/CNAME", () => {
    expect(validateDnsRecord(validRecord({ name: "*" }))).toEqual([]);
  });

  it("requires priority for MX and SRV", () => {
    expect(validateDnsRecord(validRecord({ type: "MX", data: "mail.example.com" }))).toEqual([
      "priority is required for MX records.",
    ]);
    expect(
      validateDnsRecord(validRecord({ type: "SRV", data: "sip.example.com", priority: 10 })),
    ).toEqual(["priority, port, and weight are required for SRV records."]);
  });
});

describe("runListDnsRecords", () => {
  it("filters by type/name and requests totals", async () => {
    const { calls, restore } = mockFetch(() => ({
      body: {
        items: [
          { recordId: "rec_1", name: "www", type: "A", data: "1.2.3.4", ttl: 3600 },
        ],
        totalItems: 1,
        totalPages: 1,
        links: [],
      },
    }));
    await runListDnsRecords(
      { domain: "example.com", type: "A", name: "www", pageSize: 100 },
      config,
    );
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v3/domains/zones/example.com/dns-records");
    expect(url.searchParams.get("type")).toBe("A");
    expect(url.searchParams.get("name")).toBe("www");
    expect(url.searchParams.get("pageSize")).toBe("100");
    expect(url.searchParams.get("totalRequired")).toBe("true");
    restore();
  });

  it("notes when more pages exist", async () => {
    const { restore } = mockFetch(() => ({
      body: { items: [], totalItems: 42, totalPages: 2, links: [] },
    }));
    const res = await runListDnsRecords({ domain: "example.com" }, config);
    expect(resultSummary(res.content[0]!.text)).toContain("Page 1 of 2");
    restore();
  });
});

describe("runAddDnsRecord", () => {
  it("posts the record without the domain field", async () => {
    const { calls, restore } = mockFetch(() => ({
      status: 201,
      body: { recordId: "rec_new", name: "www", type: "A", data: "93.184.216.34", ttl: 3600 },
    }));
    const res = await runAddDnsRecord({ domain: "example.com", ...validRecord() }, config);
    expect(calls[0].url).toBe("https://api.test.com/v3/domains/zones/example.com/dns-records");
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ name: "www", type: "A", data: "93.184.216.34", ttl: 3600 });
    expect(body.domain).toBeUndefined();
    expect(resultSummary(res.content[0]!.text)).toContain("rec_new");
    restore();
  });

  it("refuses invalid records before calling the API", async () => {
    const { calls, restore } = mockFetch(() => ({ body: {} }));
    await expect(
      runAddDnsRecord(
        { domain: "example.com", ...validRecord({ type: "CNAME", name: "@" }) },
        config,
      ),
    ).rejects.toThrow("CNAME records are not allowed at the zone apex");
    expect(calls).toHaveLength(0);
    restore();
  });
});

describe("runUpdateDnsRecord", () => {
  it("puts the full record to its recordId URL", async () => {
    const { calls, restore } = mockFetch(() => ({
      body: { recordId: "rec_1", name: "@", type: "A", data: "192.0.2.1", ttl: 3600 },
    }));
    const res = await runUpdateDnsRecord(
      { domain: "example.com", recordId: "rec_1", type: "A", name: "@", data: "192.0.2.1", ttl: 3600 },
      config,
    );
    expect(calls[0].url).toBe(
      "https://api.test.com/v3/domains/zones/example.com/dns-records/rec_1",
    );
    expect(calls[0].init.method).toBe("PUT");
    const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ type: "A", name: "@", data: "192.0.2.1", ttl: 3600 });
    expect(resultSummary(res.content[0]!.text)).toContain("Replaced DNS record rec_1");
    restore();
  });
});

describe("runDeleteDnsRecord", () => {
  it("deletes by recordId and reports success", async () => {
    const { calls, restore } = mockFetch(() => ({ status: 204 }));
    const res = await runDeleteDnsRecord({ domain: "example.com", recordId: "rec_9" }, config);
    expect(calls[0].url).toBe(
      "https://api.test.com/v3/domains/zones/example.com/dns-records/rec_9",
    );
    expect(calls[0].init.method).toBe("DELETE");
    expect(res.isError).toBeUndefined();
    expect(resultSummary(res.content[0]!.text)).toContain("Deleted DNS record rec_9");
    restore();
  });

  it("surfaces 404 errors from deleting unknown records", async () => {
    const { restore } = mockFetch(() => ({
      status: 404,
      body: { status: 404, code: "not_found", message: "record not found" },
    }));
    await expect(
      runDeleteDnsRecord({ domain: "example.com", recordId: "nope" }, config),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    restore();
  });
});
