import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { godaddyRequest, type Paged } from "../client.ts";
import { getConfig, type GodaddyConfig } from "../config.ts";
import { okResult, withTool } from "../handler.ts";
import { formatMoney } from "../format.ts";

export const domainName = z
  .string()
  .min(1)
  .max(255)
  .describe(
    "Fully-qualified domain name, e.g. example.com (punycode A-label form for internationalized domains).",
  );

interface DomainItem {
  domain: string;
  status?: string;
  expiresAt?: string;
  renewBy?: string;
  createdAt?: string;
  autoRenew?: boolean;
  privacy?: boolean;
  transferLock?: boolean;
  nameServers?: string[];
}

function compactDomain(d: DomainItem): Record<string, unknown> {
  return {
    domain: d.domain,
    status: d.status,
    expiresAt: d.expiresAt,
    renewBy: d.renewBy,
    autoRenew: d.autoRenew,
    privacy: d.privacy,
    transferLock: d.transferLock,
    nameServers: d.nameServers,
  };
}

export async function runListDomains(
  args: {
    statuses?: string[];
    lifecycleGroups?: string[];
    updatedAfter?: string;
    expiresBefore?: string;
    pageSize?: number;
    pageToken?: string;
    pageTokenDirection?: "forward" | "backward";
  },
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  const result = await godaddyRequest<Paged<DomainItem>>(config, "/v3/domains/domain-names", {
    query: {
      statuses:
        args.statuses && args.statuses.length > 0
          ? args.statuses.map((s) => s.toUpperCase()).join(",")
          : undefined,
      lifecycleGroups:
        args.lifecycleGroups && args.lifecycleGroups.length > 0
          ? args.lifecycleGroups.map((s) => s.toUpperCase()).join(",")
          : undefined,
      updatedAfter: args.updatedAfter,
      expiresBefore: args.expiresBefore,
      pageSize: args.pageSize,
      pageToken: args.pageToken,
      pageTokenDirection: args.pageTokenDirection,
    },
  });

  const nextLink = result.links?.find((l) => l.rel === "next");
  const summary = `${result.items.length} domain(s) in this page${
    nextLink ? " — more available, pass the next link's pageToken" : ""
  }.`;
  return okResult({ domains: result.items.map(compactDomain), next: nextLink?.href }, summary);
}

export async function runGetDomain(
  args: { domain: string },
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  const result = await godaddyRequest<DomainItem & Record<string, unknown>>(
    config,
    `/v3/domains/domain-names/${encodeURIComponent(args.domain)}`,
  );
  const summary =
    `Domain ${result.domain} (${result.status ?? "unknown"}): expires ${result.expiresAt ?? "unknown"}, auto-renew ${
      result.autoRenew ? "ON" : "OFF"
    }${result.renewBy ? `, renew by ${result.renewBy}` : ""}.`;
  return okResult(compactDomain(result), summary);
}

export async function runRenewDomain(
  args: {
    domain: string;
    period?: number;
  },
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  const result = await godaddyRequest<{ orderId: number; total?: number; currency?: string }>(
    config,
    `/v1/domains/${encodeURIComponent(args.domain)}/renew`,
    { method: "POST", body: { period: args.period ?? 1 } },
  );
  const summary = `Renewal order ${result.orderId} placed for ${args.domain}.`;
  return okResult(
    {
      domain: args.domain,
      orderId: result.orderId,
      total: result.total !== undefined ? formatMoney({ currencyCode: result.currency, value: result.total }) : undefined,
    },
    summary,
  );
}

export const listDomainsSchema = {
  statuses: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe(
      "Filter to these exact lifecycle statuses (e.g. ACTIVE, EXPIRED, PENDING_TRANSFER). Combined with OR.",
    ),
  lifecycleGroups: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Coarse filter to lifecycle groups (e.g. REGISTERED, PENDING, EXPIRED, CANCELLED). Cannot be combined with statuses.",
    ),
  updatedAfter: z
    .string()
    .optional()
    .describe("Only domains last updated after this RFC 3339 timestamp (exclusive)."),
  expiresBefore: z
    .string()
    .optional()
    .describe("Only domains expiring before this RFC 3339 timestamp (exclusive)."),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max domains per page (1-200, default 100)."),
  pageToken: z.string().optional().describe("Opaque cursor from a previous response's next link."),
  pageTokenDirection: z
    .enum(["forward", "backward"])
    .optional()
    .describe("Token direction when pageToken is set."),
};

export const getDomainSchema = {
  domain: domainName,
};

export const renewDomainSchema = {
  domain: domainName,
  period: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Years to renew (default 1). Charges the account's billing method."),
};

export function registerDomainTools(server: McpServer): void {
  server.registerTool(
    "list_domains",
    {
      title: "List domains",
      description:
        "List domains owned by the GoDaddy account, with registry status, expiration dates, auto-renew flag, privacy, and transfer lock. Read-only.",
      inputSchema: listDomainsSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withTool(runListDomains),
  );

  server.registerTool(
    "get_domain",
    {
      title: "Get domain details",
      description:
        "Get full details for one domain: lifecycle status, expiration (expiresAt and renewBy), auto-renew, WHOIS privacy, transfer lock, and current nameservers. Read-only.",
      inputSchema: getDomainSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withTool(runGetDomain),
  );

  server.registerTool(
    "renew_domain",
    {
      title: "Renew domain",
      description:
        "Renew a domain for the given number of years (default 1). CHARGES THE ACCOUNT's billing method and cannot be undone. Confirm the domain and period with the user first. The account must have a valid billing method on file.",
      inputSchema: renewDomainSchema,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    withTool(runRenewDomain),
  );
}
