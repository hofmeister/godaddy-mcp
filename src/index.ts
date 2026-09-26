#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerDomainTools } from "./tools/domains.ts";
import { registerDnsTools } from "./tools/dns.ts";
import { registerSearchTools } from "./tools/search.ts";
import { registerRegistrationTools } from "./tools/register.ts";
import { purchasesEnabled } from "./config.ts";

const server = new McpServer({
  name: "godaddy-domains",
  version: "0.1.0",
});

const purchases = purchasesEnabled();
registerDomainTools(server, { purchases });
registerDnsTools(server);
registerSearchTools(server);
registerRegistrationTools(server, { purchases });

const transport = new StdioServerTransport();
await server.connect(transport);
