import { describe, it, expect } from "vitest";
import {
  runGetRegistrationQuote,
  runRegisterDomain,
  runSetNameservers,
} from "../src/tools/register.js";
import type { GodaddyConfig } from "../src/config.js";
import { mockFetch, resultJson, resultSummary } from "./helpers.js";

const config: GodaddyConfig = { pat: "test-pat", baseUrl: "https://api.test.com" };

const fastPoll = { intervalMs: 1, timeoutMs: 5_000 };

describe("runGetRegistrationQuote", () => {
  it("posts the quote and surfaces agreements + next step", async () => {
    const { calls, restore } = mockFetch(() => ({
      body: {
        domain: "example.com",
        available: true,
        quoteToken: "qt_abc123",
        period: 1,
        price: { currencyCode: "USD", value: 1199 },
        renewalPrice: { currencyCode: "USD", value: 2299 },
        requiredAgreements: [
          {
            agreementType: "API_DPA",
            title: "API Domain Purchase Agreement",
            url: "https://www.godaddy.com/agreements/showdoc?pageid=reg_sa",
          },
        ],
        expiresAt: "2026-01-15T10:45:00.000Z",
      },
    }));
    const res = await runGetRegistrationQuote({ domain: "example.com" }, config);
    expect(calls[0].url).toBe("https://api.test.com/v3/domains/registration-quotes");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify({ domain: "example.com", period: undefined }));

    const json = resultJson(res.content[0]!.text);
    expect(json.quoteToken).toBe("qt_abc123");
    expect(json.price).toBe("11.99 USD");
    expect(json.requiredAgreements[0].agreementType).toBe("API_DPA");
    expect(json.nextStep).toContain("register_domain");
    expect(resultSummary(res.content[0]!.text)).toContain("locked until 2026-01-15T10:45:00.000Z");
    restore();
  });

  it("flags fees for premium domains", async () => {
    const { restore } = mockFetch(() => ({
      body: {
        domain: "premium.com",
        quoteToken: "qt_x",
        period: 1,
        price: { currencyCode: "USD", value: 1199 },
        fees: [
          { type: "ONE_TIME_PREMIUM_DOMAIN_PURCHASE", fee: { currencyCode: "USD", value: 390000 } },
        ],
        requiredAgreements: [{ agreementType: "API_DPA" }],
      },
    }));
    const res = await runGetRegistrationQuote({ domain: "premium.com" }, config);
    const json = resultJson(res.content[0]!.text);
    expect(json.fees).toEqual([
      { type: "ONE_TIME_PREMIUM_DOMAIN_PURCHASE", amount: "3900.00 USD" },
    ]);
    expect(json.nextStep).toContain("acknowledgedFees");
    restore();
  });
});

describe("runRegisterDomain", () => {
  it("executes the quote with consent and polls to COMPLETED", async () => {
    const { calls, restore } = mockFetch([
      () => ({
        status: 202,
        body: { registrationId: "reg_1", operationId: "op_1", status: "CONFIRMED" },
      }),
      () => ({
        body: { registrationId: "reg_1", status: "EXECUTING" },
      }),
      () => ({
        body: {
          registrationId: "reg_1",
          status: "COMPLETED",
          domain: "example.com",
          expiresAt: "2027-01-15T10:45:00.000Z",
          price: { currencyCode: "USD", value: 1199 },
        },
      }),
    ]);
    const res = await runRegisterDomain(
      {
        domain: "example.com",
        period: 1,
        quoteToken: "qt_abc123",
        agreementTypes: ["API_DPA"],
        agreedAt: "2026-01-15T10:30:00.000Z",
      },
      fastPoll,
      config,
    );

    const post = calls[0];
    expect(post.url).toBe("https://api.test.com/v3/domains/registrations");
    expect(post.init.method).toBe("POST");
    const headers = post.init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"].length).toBeGreaterThanOrEqual(16);
    const body = JSON.parse(post.init.body as string) as Record<string, any>;
    expect(body).toEqual({
      quoteToken: "qt_abc123",
      domain: "example.com",
      period: 1,
      consent: { agreementTypes: ["API_DPA"], agreedAt: "2026-01-15T10:30:00.000Z" },
    });

    // poll calls target the concrete registration resource
    expect(calls[1].url).toBe("https://api.test.com/v3/domains/registrations/reg_1");
    expect(calls.length).toBe(3);

    const json = resultJson(res.content[0]!.text);
    expect(json.status).toBe("COMPLETED");
    expect(json.registrationId).toBe("reg_1");
    expect(json.expiresAt).toBe("2027-01-15T10:45:00.000Z");
    expect(json.price).toBe("11.99 USD");
    expect(resultSummary(res.content[0]!.text)).toContain("Registered example.com");
    restore();
  });

  it("includes acknowledgedFees when present", async () => {
    const { calls, restore } = mockFetch([
      () => ({
        status: 202,
        body: { registrationId: "reg_2", status: "CONFIRMED" },
      }),
      () => ({
        body: { registrationId: "reg_2", status: "COMPLETED", domain: "premium.com" },
      }),
    ]);
    await runRegisterDomain(
      {
        domain: "premium.com",
        period: 1,
        quoteToken: "qt_x",
        agreementTypes: ["API_DPA"],
        acknowledgedFees: [
          { type: "ONE_TIME_PREMIUM_DOMAIN_PURCHASE", fee: { currencyCode: "USD", value: 390000 } },
        ],
        idempotencyKey: "fixed-key-1234567890",
      },
      fastPoll,
      config,
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("fixed-key-1234567890");
    const body = JSON.parse(calls[0].init.body as string) as Record<string, any>;
    expect(body.consent.acknowledgedFees).toHaveLength(1);
    restore();
  });

  it("returns an error result when the registration fails", async () => {
    const { restore } = mockFetch([
      () => ({
        status: 202,
        body: { registrationId: "reg_3", status: "CONFIRMED" },
      }),
      () => ({
        body: {
          registrationId: "reg_3",
          status: "FAILED",
          error: { code: "billing_issue", message: "no payment method on file" },
        },
      }),
    ]);
    const res = await runRegisterDomain(
      {
        domain: "example.com",
        period: 1,
        quoteToken: "qt_x",
        agreementTypes: ["API_DPA"],
      },
      fastPoll,
      config,
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("no payment method on file");
    expect(res.content[0]!.text).toContain("billing_issue");
    restore();
  });

  it("reports in-progress instead of failing when the poll times out", async () => {
    const { calls, restore } = mockFetch([
      () => ({
        status: 202,
        body: { registrationId: "reg_4", status: "CONFIRMED" },
      }),
      () => ({
        body: { registrationId: "reg_4", status: "EXECUTING" },
      }),
    ]);
    const res = await runRegisterDomain(
      {
        domain: "example.com",
        period: 1,
        quoteToken: "qt_x",
        agreementTypes: ["API_DPA"],
      },
      { intervalMs: 1, timeoutMs: 15 },
      config,
    );
    expect(res.isError).toBeUndefined();
    const json = resultJson(res.content[0]!.text);
    expect(json.status).toBe("EXECUTING");
    expect(json.note).toContain("still in progress");
    expect(calls.length).toBeGreaterThan(2);
    restore();
  });

  it("surfaces API errors from the execute call itself", async () => {
    const { restore } = mockFetch(() => ({
      status: 422,
      body: {
        status: 422,
        code: "QUOTE_MISMATCH",
        message: "period does not match",
        fields: [{ name: "period", message: "must be 1" }],
      },
    }));
    await expect(
      runRegisterDomain(
        {
          domain: "example.com",
          period: 2,
          quoteToken: "qt_x",
          agreementTypes: ["API_DPA"],
        },
        fastPoll,
        config,
      ),
    ).rejects.toMatchObject({ status: 422, code: "QUOTE_MISMATCH" });
    restore();
  });
});

describe("runSetNameservers", () => {
  it("puts the full nameserver list and polls the operation", async () => {
    const { calls, restore } = mockFetch([
      () => ({
        status: 202,
        body: { operationId: "op_9", status: "CONFIRMED" },
      }),
      () => ({
        body: { operationId: "op_9", status: "EXECUTING" },
      }),
      () => ({
        body: { operationId: "op_9", status: "COMPLETED", result: {} },
      }),
    ]);
    const res = await runSetNameservers(
      {
        domain: "example.com",
        nameservers: ["ns1.other-dns.com", "ns2.other-dns.com"],
      },
      fastPoll,
      config,
    );
    expect(calls[0].url).toBe(
      "https://api.test.com/v3/domains/domain-names/example.com/nameservers",
    );
    expect(calls[0].init.method).toBe("PUT");
    expect(calls[0].init.body).toBe(
      JSON.stringify(["ns1.other-dns.com", "ns2.other-dns.com"]),
    );
    expect(calls[1].url).toBe("https://api.test.com/v3/domains/operations/op_9");
    const json = resultJson(res.content[0]!.text);
    expect(json.status).toBe("COMPLETED");
    expect(resultSummary(res.content[0]!.text)).toContain("ns1.other-dns.com, ns2.other-dns.com");
    restore();
  });

  it("reports failure with the operation error", async () => {
    const { restore } = mockFetch([
      () => ({
        status: 202,
        body: { operationId: "op_10", status: "CONFIRMED" },
      }),
      () => ({
        body: {
          operationId: "op_10",
          status: "FAILED",
          error: { code: "registry_rejected", message: "NS not allowed" },
        },
      }),
    ]);
    const res = await runSetNameservers(
      { domain: "example.com", nameservers: ["ns1.x.com", "ns2.x.com"] },
      fastPoll,
      config,
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("NS not allowed");
    restore();
  });
});
