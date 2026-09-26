import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { godaddyRequest, type Paged } from "../client.ts";
import { getConfig, type GodaddyConfig } from "../config.ts";
import { okResult, withTool } from "../handler.ts";

export const DNS_RECORD_TYPES = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "NS",
  "SRV",
  "SOA",
  "CAA",
] as const;

export const dnsType = z.enum(DNS_RECORD_TYPES);

const name = z
  .string()
  .min(1)
  .max(255)
  .describe(
    "Record name relative to the zone apex: use @ for the bare domain, www for www.example.com, or * for a wildcard. Never include the domain itself (e.g. not www.example.com).",
  );

const data = z
  .string()
  .min(1)
  .max(512)
  .describe(
    "Record value. Type-specific: IPv4 address for A, IPv6 for AAAA, hostname for CNAME and MX, text for TXT, target host for SRV, issuer for CAA.",
  );

const ttl = z
  .number()
  .int()
  .min(600)
  .max(86400)
  .describe("Time-to-live in seconds (600-86400).");

const recordExtras = {
  priority: z
    .number()
    .int()
    .min(0)
    .max(65535)
    .optional()
    .describe("Priority for MX and SRV records; lower is preferred. Required for MX and SRV."),
  weight: z
    .number()
    .int()
    .min(0)
    .max(65535)
    .optional()
    .describe("Weight for SRV records with equal priority."),
  port: z.number().int().min(0).max(65535).optional().describe("Port for SRV records."),
  service: z
    .string()
    .optional()
    .describe("Service label for SRV records, e.g. _http."),
  protocol: z
    .string()
    .optional()
    .describe("Protocol label for SRV records, e.g. _tcp."),
  flag: z
    .number()
    .int()
    .min(0)
    .max(255)
    .optional()
    .describe("CAA flag: 0 non-critical, 128 critical."),
  tag: z
    .string()
    .optional()
    .describe("CAA property tag: issue, issuewild, or iodef."),
};

export interface DnsRecordInput {
  type: (typeof DNS_RECORD_TYPES)[number];
  name: string;
  data: string;
  ttl: number;
  priority?: number;
  weight?: number;
  port?: number;
  service?: string;
  protocol?: string;
  flag?: number;
  tag?: string;
}

export interface DnsRecord extends DnsRecordInput {
  recordId?: string;
}

/** Local sanity checks before hitting the API (the server validates too). */
export function validateDnsRecord(record: DnsRecordInput): string[] {
  const problems: string[] = [];
  if (record.type === "SOA") {
    problems.push("SOA records are managed by GoDaddy and cannot be created or modified.");
  }
  if (record.type === "NS" && record.name === "@") {
    problems.push(
      "The zone's authoritative NS set is managed by GoDaddy; use set_nameservers instead.",
    );
  }
  if (record.type === "CNAME" && record.name === "@") {
    problems.push("CNAME records are not allowed at the zone apex (@).");
  }
  if (record.name.startsWith("*") && !["A", "AAAA", "CNAME"].includes(record.type)) {
    problems.push(`Wildcard (*) records are only supported for A, AAAA, and CNAME.`);
  }
  if (record.type === "MX" && record.priority === undefined) {
    problems.push("priority is required for MX records.");
  }
  if (
    record.type === "SRV" &&
    (record.priority === undefined || record.port === undefined || record.weight === undefined)
  ) {
    problems.push("priority, port, and weight are required for SRV records.");
  }
  return problems;
}

export async function runListDnsRecords(
  args: {
    domain: string;
    type?: (typeof DNS_RECORD_TYPES)[number];
    name?: string;
    page?: number;
    pageSize?: number;
  },
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  const result = await godaddyRequest<Paged<DnsRecord>>(
    config,
    `/v3/domains/zones/${encodeURIComponent(args.domain)}/dns-records`,
    {
      query: {
        type: args.type,
        name: args.name,
        page: args.page,
        pageSize: args.pageSize,
        totalRequired: true,
      },
    },
  );
  const note =
    result.totalPages !== undefined && (args.page ?? 1) < result.totalPages
      ? ` Page ${args.page ?? 1} of ${result.totalPages}; request the next page for more records.`
      : "";
  return okResult(
    { domain: args.domain, total: result.totalItems, records: result.items },
    `${result.items.length} DNS record(s) on ${args.domain}.${note}`,
  );
}

export async function runAddDnsRecord(
  args: DnsRecordInput & { domain: string },
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  const problems = validateDnsRecord(args);
  if (problems.length > 0) {
    throw new Error(problems.join(" "));
  }
  const { domain, ...record } = args;
  const created = await godaddyRequest<DnsRecord>(
    config,
    `/v3/domains/zones/${encodeURIComponent(domain)}/dns-records`,
    { method: "POST", body: record },
  );
  return okResult(
    { ...record, recordId: created.recordId },
    `Added ${record.type} record ${record.name} -> ${record.data} on ${domain} (recordId ${created.recordId}).`,
  );
}

export async function runUpdateDnsRecord(
  args: DnsRecordInput & { domain: string; recordId: string },
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  const problems = validateDnsRecord(args);
  if (problems.length > 0) {
    throw new Error(problems.join(" "));
  }
  const { domain, recordId, ...record } = args;
  const updated = await godaddyRequest<DnsRecord>(
    config,
    `/v3/domains/zones/${encodeURIComponent(domain)}/dns-records/${encodeURIComponent(recordId)}`,
    { method: "PUT", body: record },
  );
  return okResult(
    { ...record, recordId: updated.recordId ?? recordId },
    `Replaced DNS record ${recordId} on ${domain}: ${record.type} ${record.name} -> ${record.data}.`,
  );
}

export async function runDeleteDnsRecord(
  args: {
    domain: string;
    recordId: string;
  },
  config: GodaddyConfig = getConfig(),
): Promise<ReturnType<typeof okResult>> {
  await godaddyRequest<void>(
    config,
    `/v3/domains/zones/${encodeURIComponent(args.domain)}/dns-records/${encodeURIComponent(args.recordId)}`,
    { method: "DELETE" },
  );
  return okResult(
    { domain: args.domain, recordId: args.recordId },
    `Deleted DNS record ${args.recordId} from ${args.domain}. This is irreversible.`,
  );
}

export const listDnsRecordsSchema = {
  domain: z
    .string()
    .min(1)
    .max(255)
    .describe("Domain whose zone to read, e.g. example.com."),
  type: dnsType.optional().describe("Filter to one record type."),
  name: z
    .string()
    .optional()
    .describe("Filter to records with this host name (e.g. www, _acme-challenge, or @ for apex)."),
  page: z.number().int().min(1).optional().describe("Page number (1-based, default 1)."),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Records per page (1-100, default 25)."),
};

export const addDnsRecordSchema = {
  domain: z
    .string()
    .min(1)
    .max(255)
    .describe("Domain whose zone to modify, e.g. example.com."),
  type: dnsType.describe("DNS record type."),
  name,
  data,
  ttl,
  ...recordExtras,
};

export const updateDnsRecordSchema = {
  ...addDnsRecordSchema,
  recordId: z
    .string()
    .min(1)
    .describe(
      "recordId of the existing record to replace (from list_dns_records). PUT replaces the whole record, so all fields are required.",
    ),
};

export const deleteDnsRecordSchema = {
  domain: z
    .string()
    .min(1)
    .max(255)
    .describe("Domain whose zone to modify, e.g. example.com."),
  recordId: z
    .string()
    .min(1)
    .describe("recordId of the record to delete (from list_dns_records). Deletion is irreversible."),
};

export function registerDnsTools(server: McpServer): void {
  server.registerTool(
    "list_dns_records",
    {
      title: "List DNS records",
      description:
        "List DNS records for a domain hosted on GoDaddy's authoritative nameservers. Filter by type and/or name (@ = zone apex). Records include the recordId needed to update or delete them. Read-only.",
      inputSchema: listDnsRecordsSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withTool(runListDnsRecords),
  );

  server.registerTool(
    "add_dns_record",
    {
      title: "Add DNS record",
      description:
        "Add a DNS record to a domain's zone without touching existing records. Record name is relative to the zone apex (@ = bare domain, www = www.example.com, * = wildcard). TTL 600-86400 seconds. MX and SRV require priority (SRV also port and weight); CNAME cannot be set at the apex; SOA and the apex NS set are managed by GoDaddy. The record is created synchronously and the response includes its recordId.",
      inputSchema: addDnsRecordSchema,
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    withTool(runAddDnsRecord),
  );

  server.registerTool(
    "update_dns_record",
    {
      title: "Replace DNS record",
      description:
        "Replace an existing DNS record (identified by recordId from list_dns_records). This is a FULL replacement: name, type, data, and ttl must all be supplied; omitted fields are not preserved. GoDaddy-managed SOA and apex NS records cannot be replaced.",
      inputSchema: updateDnsRecordSchema,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    withTool(runUpdateDnsRecord),
  );

  server.registerTool(
    "delete_dns_record",
    {
      title: "Delete DNS record",
      description:
        "Permanently delete one DNS record (identified by recordId from list_dns_records). Irreversible — verify the record first. GoDaddy-managed SOA and apex NS records cannot be deleted.",
      inputSchema: deleteDnsRecordSchema,
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    withTool(runDeleteDnsRecord),
  );
}
