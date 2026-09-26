/**
 * Smoke test against the real GoDaddy API.
 *
 * Requires GODADDY_PAT to be set. Read-only: lists domains and checks
 * availability for a nonsense domain.
 *
 *   GODADDY_PAT=... npm run smoke
 */
import { getConfig } from "../src/config.ts";
import { godaddyRequest, type Paged } from "../src/client.ts";
import { runListDomains, runGetDomain } from "../src/tools/domains.ts";
import { runCheckDomainAvailability } from "../src/tools/search.ts";

function print(label: string, res: { content: Array<{ text?: string }> }): void {
  const text = res.content.map((c) => c.text).filter(Boolean).join("\n");
  console.log(`\n=== ${label} ===\n${text}`);
}

const config = getConfig();
console.log(`Using ${config.baseUrl}`);

const domains = await godaddyRequest<Paged<{ domain: string }>>(config, "/v3/domains/domain-names", {
  query: { pageSize: 5 },
});
console.log(`\nAccount has domains: ${domains.items.map((d) => d.domain).join(", ") || "(none)"}`);

if (domains.items.length > 0) {
  const first = domains.items[0]!.domain;
  print("list_domains", await runListDomains({}, config));
  print("get_domain", await runGetDomain({ domain: first }, config));
}

print(
  "check_domain_availability",
  await runCheckDomainAvailability(
    { domains: [`unavailable-smoke-check-${Date.now()}.invalid`], optimizeFor: "SPEED" },
    config,
  ),
);

console.log("\nSmoke test complete.");
