import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { godaddyRequest, pollResource } from "../client.js";
import { getConfig, type GodaddyConfig } from "../config.js";
import { errResult, okResult, withTool } from "../handler.js";
import { formatMoney } from "../format.js";

interface Agreement {
  agreementType: string;
  title?: string;
  url?: string;
}

interface QuoteResponse {
  domain?: string;
  available?: boolean;
  quoteToken?: string;
  period?: number;
  price?: { currencyCode?: string; value: number };
  renewalPrice?: { currencyCode?: string; value: number };
  fees?: Array<{ type: string; fee: { currencyCode?: string; value: number } }>;
  requiredAgreements?: Agreement[];
  expiresAt?: string;
}

interface RegistrationResponse {
  registrationId?: string;
  operationId?: string;
  domain?: string;
  status?: string;
  period?: number;
  price?: { currencyCode?: string; value: number };
  expiresAt?: string;
  error?: { code?: string; message?: string };
}

export interface RegisterPollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export async function runGetRegistrationQuote(
  args: {
    domain: string;
    period?: number;
  },
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  const quote = await godaddyRequest<QuoteResponse>(config, "/v3/domains/registration-quotes", {
    method: "POST",
    body: { domain: args.domain, period: args.period },
  });
  const fees = Array.isArray(quote.fees) && quote.fees.length > 0 ? quote.fees : undefined;
  return okResult(
    {
      domain: quote.domain ?? args.domain,
      period: quote.period,
      quoteToken: quote.quoteToken,
      quoteExpiresAt: quote.expiresAt,
      price: formatMoney(quote.price),
      renewalPrice: formatMoney(quote.renewalPrice),
      fees: fees?.map((f) => ({ type: f.type, amount: formatMoney(f.fee) })),
      requiredAgreements: quote.requiredAgreements ?? [],
      nextStep: fees
        ? "Show the user the price, fees, and each required agreement (title + url). After they explicitly confirm, call register_domain with quoteToken, agreementTypes from requiredAgreements, and acknowledgedFees matching the fees above verbatim."
        : "Show the user the price and each required agreement (title + url). After they explicitly confirm, call register_domain with quoteToken and agreementTypes from requiredAgreements.",
    },
    `Quote for ${args.domain}: ${formatMoney(quote.price) ?? "unknown"} for ${quote.period ?? args.period ?? 1} year(s), locked until ${quote.expiresAt ?? "an unknown time"}.`,
  );
}

export interface RegisterDomainArgs {
  domain: string;
  period: number;
  quoteToken: string;
  agreementTypes: string[];
  agreedAt?: string;
  acknowledgedFees?: Array<{ type: string; fee: { currencyCode: string; value: number } }>;
  idempotencyKey?: string;
}

export async function runRegisterDomain(
  args: RegisterDomainArgs,
  pollOptions: RegisterPollOptions = {},
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  const idempotencyKey = args.idempotencyKey ?? randomUUID();
  const consent: Record<string, unknown> = {
    agreementTypes: args.agreementTypes,
    agreedAt: args.agreedAt ?? new Date().toISOString(),
  };
  if (args.acknowledgedFees && args.acknowledgedFees.length > 0) {
    consent.acknowledgedFees = args.acknowledgedFees;
  }

  const started = await godaddyRequest<RegistrationResponse>(
    config,
    "/v3/domains/registrations",
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: { quoteToken: args.quoteToken, domain: args.domain, period: args.period, consent },
    },
  );

  const registrationId = started.registrationId ?? started.operationId;
  if (!registrationId) {
    return errResult(new Error("Registration accepted but no registrationId was returned."));
  }

  const { resource, timedOut } = await pollResource<RegistrationResponse>(
    config,
    `/v3/domains/registrations/${encodeURIComponent(registrationId)}`,
    pollOptions,
  );

  const base = {
    domain: resource.domain ?? args.domain,
    status: resource.status,
    registrationId,
    operationId: resource.operationId,
    idempotencyKey,
  };

  if (resource.status === "FAILED") {
    const detail = resource.error?.message
      ? ` Registration failed: ${resource.error.message}${resource.error.code ? ` [code=${resource.error.code}]` : ""}`
      : "";
    return errResult(new Error(`Registration of ${args.domain} did not complete.${detail}`));
  }

  if (timedOut) {
    return okResult(
      { ...base, note: "Registration still in progress after waiting; check get_domain or list_domains later to confirm." },
      `Registration of ${args.domain} accepted (status ${resource.status}) but had not finished yet.`,
    );
  }

  return okResult(
    { ...base, expiresAt: resource.expiresAt, price: formatMoney(resource.price) },
    `Registered ${args.domain} (${args.period} year(s), expires ${resource.expiresAt ?? "unknown"}).`,
  );
}

export async function runSetNameservers(
  args: {
    domain: string;
    nameservers: string[];
  },
  pollOptions: RegisterPollOptions = {},
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  const started = await godaddyRequest<{ operationId?: string; status?: string }>(
    config,
    `/v3/domains/domain-names/${encodeURIComponent(args.domain)}/nameservers`,
    {
      method: "PUT",
      headers: { "Idempotency-Key": randomUUID() },
      body: args.nameservers,
    },
  );
  const operationId = started.operationId;
  if (!operationId) {
    return errResult(new Error("Nameserver update accepted but no operationId was returned."));
  }

  const { resource, timedOut } = await pollResource<{ status?: string; result?: unknown; error?: { code?: string; message?: string } }>(
    config,
    `/v3/domains/operations/${encodeURIComponent(operationId)}`,
    pollOptions,
  );

  if (resource.status === "FAILED") {
    const detail = resource.error?.message ? `: ${resource.error.message}` : "";
    return errResult(new Error(`Nameserver update for ${args.domain} failed${detail}`));
  }

  if (timedOut) {
    return okResult(
      {
        domain: args.domain,
        nameservers: args.nameservers,
        operationId,
        status: resource.status,
        note: "Nameserver change still propagating; it will take effect shortly.",
      },
      `Nameserver update for ${args.domain} accepted (still propagating).`,
    );
  }

  return okResult(
    { domain: args.domain, nameservers: args.nameservers, operationId, status: resource.status },
    `Nameservers for ${args.domain} updated to: ${args.nameservers.join(", ")}.`,
  );
}

export const getRegistrationQuoteSchema = {
  domain: z
    .string()
    .min(2)
    .max(255)
    .describe("Domain to register, e.g. example.com (must be available)."),
  period: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Registration period in years (default 1)."),
};

const feeSchema = z.object({
  type: z.string().describe("Fee type, e.g. ONE_TIME_PREMIUM_DOMAIN_PURCHASE."),
  fee: z.object({
    currencyCode: z.string(),
    value: z.number().int().describe("Amount in cents (minor currency units)."),
  }),
});

export const registerDomainSchema = {
  domain: z
    .string()
    .min(2)
    .max(255)
    .describe("Domain to register. Must exactly match the domain in the quote."),
  period: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("Registration period in years. Must match the quoted period or the API rejects with QUOTE_MISMATCH."),
  quoteToken: z
    .string()
    .min(1)
    .describe("quoteToken from get_registration_quote. The price is locked to this token; if it expires, get a new quote."),
  agreementTypes: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "The agreementType values from the quote's requiredAgreements. Do not hardcode; they depend on the TLD.",
    ),
  agreedAt: z
    .string()
    .datetime()
    .optional()
    .describe(
      "ISO 8601 timestamp of when the user actually confirmed the purchase (default: now). Use the real consent time, not a synthetic one.",
    ),
  acknowledgedFees: z
    .array(feeSchema)
    .optional()
    .describe(
      "Required only when the quote's fees array is non-empty (e.g. premium domains). Must match the quote's fees verbatim.",
    ),
  idempotencyKey: z
    .string()
    .min(16)
    .max(64)
    .optional()
    .describe("Idempotency key for this execution (default: a generated UUID). Reuse it when retrying after a timeout."),
};

export const setNameserversSchema = {
  domain: z
    .string()
    .min(2)
    .max(255)
    .describe("Domain whose authoritative nameservers to replace."),
  nameservers: z
    .array(z.string().min(4).max(253))
    .min(2)
    .max(13)
    .describe(
      "New authoritative nameservers, e.g. [\"ns1.example-dns.com\", \"ns2.example-dns.com\"]. 2-13 hostnames. Replaces the full set; DNS managed via list/add/update_dns_record will stop being served after the cutover.",
    ),
};

export function registerRegistrationTools(server: McpServer): void {
  server.registerTool(
    "get_registration_quote",
    {
      description:
        "Get a price quote for registering a domain. This locks the price to a quoteToken for a short window and returns the required ICANN agreements that must be reviewed before registering. Read-only and does NOT charge the account. Step 1 of 2 of registration; step 2 is register_domain.",
      inputSchema: getRegistrationQuoteSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withTool(runGetRegistrationQuote),
  );

  server.registerTool(
    "register_domain",
    {
      description:
        "Register a domain using a quote from get_registration_quote. CHARGES THE ACCOUNT's billing method and is not reversible — only call it after the user has explicitly confirmed the price and agreed to the listed agreements. Requires a payment method and registrant contact on the account. The call is accepted asynchronously and this tool waits for it to finish (up to ~90s).",
      inputSchema: registerDomainSchema,
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    withTool(runRegisterDomain),
  );

  server.registerTool(
    "set_nameservers",
    {
      description:
        "Replace the authoritative nameservers for a domain (2-13 hostnames). The registry change propagates asynchronously; this tool waits until it completes or reports that it is still in progress. WARNING: switching nameservers moves DNS off GoDaddy, so records managed with the DNS tools will no longer be served by GoDaddy.",
      inputSchema: setNameserversSchema,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    withTool(runSetNameservers),
  );
}
