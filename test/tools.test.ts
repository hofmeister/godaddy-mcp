import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { purchasesEnabled } from "../src/config.ts";
import { registerDomainTools } from "../src/tools/domains.ts";
import { registerRegistrationTools } from "../src/tools/register.ts";

function registeredNames(purchases: boolean): string[] {
  const names: string[] = [];
  const server = { registerTool: (name: string) => names.push(name) } as unknown as McpServer;
  registerDomainTools(server, { purchases });
  registerRegistrationTools(server, { purchases });
  return names;
}

describe("purchase tools", () => {
  it("are off unless GODADDY_ENABLE_PURCHASES is set", () => {
    expect(purchasesEnabled({})).toBe(false);
    expect(purchasesEnabled({ GODADDY_ENABLE_PURCHASES: "" })).toBe(false);
    expect(purchasesEnabled({ GODADDY_ENABLE_PURCHASES: "0" })).toBe(false);
    expect(purchasesEnabled({ GODADDY_ENABLE_PURCHASES: "1" })).toBe(true);
    expect(purchasesEnabled({ GODADDY_ENABLE_PURCHASES: "true" })).toBe(true);
  });

  it("leaves register_domain and renew_domain out when purchases are off", () => {
    const names = registeredNames(false);
    expect(names).not.toContain("register_domain");
    expect(names).not.toContain("renew_domain");
    expect(names).toContain("get_registration_quote");
    expect(names).toContain("set_nameservers");
  });

  it("registers them when purchases are on", () => {
    const names = registeredNames(true);
    expect(names).toContain("register_domain");
    expect(names).toContain("renew_domain");
  });
});
