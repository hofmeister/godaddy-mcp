import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { godaddyRequest } from "../client.ts";
import { getConfig, type GodaddyConfig } from "../config.ts";
import { okResult, withTool } from "../handler.ts";
import { formatTermPrices, type TermPriceInput } from "../format.ts";

const domainList = z
  .array(z.string().min(2).max(255))
  .min(1)
  .max(50)
  .describe("Domain names to check, e.g. [\"mysite.com\", \"mysite.net\"].");

const optimizeFor = z
  .enum(["SPEED", "ACCURACY"])
  .optional()
  .describe(
    "SPEED (default) uses cached data; ACCURACY forces a live registry check with higher latency. Availability is re-verified at quote time either way.",
  );

interface AvailabilityItem {
  domain?: string;
  available?: boolean;
  definitive?: boolean;
  prices?: TermPriceInput[];
  error?: { name?: string; message?: string };
}

interface SuggestionItem {
  domain?: string;
  inventory?: string;
  prices?: TermPriceInput[];
}

function formatAvailability(items: AvailabilityItem[]): unknown {
  return items.map((item) =>
    item.error
      ? { domain: item.domain, available: false, error: item.error.message ?? item.error.name }
      : {
          domain: item.domain,
          available: item.available,
          definitive: item.definitive,
          prices: formatTermPrices(item.prices),
        },
  );
}

export async function runCheckDomainAvailability(
  args: {
    domains: string[];
    optimizeFor?: "SPEED" | "ACCURACY";
    iscCode?: string;
  },
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  let items: AvailabilityItem[];
  if (args.domains.length === 1) {
    const single = await godaddyRequest<AvailabilityItem>(config, "/v3/domains/check-availability", {
      query: { domain: args.domains[0], optimizeFor: args.optimizeFor, iscCode: args.iscCode },
    });
    items = [single];
  } else {
    const bulk = await godaddyRequest<{ items: AvailabilityItem[] }>(
      config,
      "/v3/domains/check-availability",
      {
        method: "POST",
        body: {
          domains: args.domains,
          optimizeFor: args.optimizeFor,
          iscCode: args.iscCode,
        },
      },
    );
    items = bulk.items;
  }

  const availableCount = items.filter((i) => i.available).length;
  const summary = `${availableCount} of ${items.length} domain(s) available for registration.`;
  return okResult({ results: formatAvailability(items) }, summary);
}

export async function runSuggestDomains(
  args: {
    query?: string;
    tlds?: string[];
    pageSize?: number;
    lengthMin?: number;
    lengthMax?: number;
    sources?: Array<"EXTENSION" | "KEYWORD_SPIN" | "CC_TLD" | "PREMIUM">;
  },
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  const result = await godaddyRequest<{ items: SuggestionItem[] }>(
    config,
    "/v3/domains/suggestions",
    {
      query: {
        query: args.query,
        tlds: args.tlds && args.tlds.length > 0 ? args.tlds.join(",") : undefined,
        pageSize: args.pageSize,
        lengthMin: args.lengthMin,
        lengthMax: args.lengthMax,
        sources: args.sources && args.sources.length > 0 ? args.sources.join(",") : undefined,
      },
    },
  );
  const suggestions = result.items.map((item) => ({
    domain: item.domain,
    inventory: item.inventory,
    prices: formatTermPrices(item.prices),
  }));
  return okResult(
    { suggestions },
    `${suggestions.length} available domain suggestion(s)${args.query ? ` for "${args.query}"` : ""}.`,
  );
}

export const checkAvailabilitySchema = {
  domains: domainList,
  optimizeFor,
  iscCode: z.string().optional().describe("ISC discount code for pricing context."),
};

export const suggestDomainsSchema = {
  query: z.string().min(1).describe("Natural-language query or keywords, e.g. \"sunrise bakery\"."),
  tlds: z
    .array(z.string().min(1))
    .optional()
    .describe("TLDs to include, e.g. [\"com\", \"net\", \"shop\"]."),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Number of suggestions (1-50, default 10)."),
  lengthMin: z.number().int().min(1).optional().describe("Minimum second-level label length."),
  lengthMax: z.number().int().max(63).optional().describe("Maximum second-level label length."),
  sources: z
    .array(z.enum(["EXTENSION", "KEYWORD_SPIN", "CC_TLD", "PREMIUM"]))
    .optional()
    .describe(
      "Suggestion strategies: EXTENSION (vary TLD), KEYWORD_SPIN (rotate keywords), CC_TLD (country-code TLDs), PREMIUM (include premium names).",
    ),
};

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "check_domain_availability",
    {
      title: "Check domain availability",
      description:
        "Check whether one or more domains are available for registration, with indicative per-term pricing (registration and renewal prices, converted from cents to whole currency units). Read-only; no payment method required. Use ACCURACY for a live registry check.",
      inputSchema: checkAvailabilitySchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withTool(runCheckDomainAvailability),
  );

  server.registerTool(
    "suggest_domains",
    {
      title: "Suggest domain names",
      description:
        "Get available domain name suggestions for a keyword or natural-language query, with indicative pricing. Read-only.",
      inputSchema: suggestDomainsSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withTool(runSuggestDomains),
  );
}
