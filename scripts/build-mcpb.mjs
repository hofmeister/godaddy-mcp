// Builds the Claude Desktop extension (.mcpb) from the compiled server in dist/.
//
//   npm run build && npm run bundle            # -> bundles/godaddy-mcp-<version>.mcpb
//   node scripts/build-mcpb.mjs --out some/folder
//
// The bundle holds the compiled JavaScript and its production dependencies, and runs on the Node.js
// that ships with Claude Desktop, so one bundle serves every platform. Requires network access for
// `npm ci` and `npx @anthropic-ai/mcpb`.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outDir = outIndex >= 0 ? args[outIndex + 1] : join(root, "bundles");
const distDir = join(root, "dist");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

if (!existsSync(join(distDir, "index.js"))) {
  console.error("dist/index.js is missing: run `npm run build` first");
  process.exit(1);
}

const stage = join(outDir, "stage");
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "server"), { recursive: true });

// The compiled server, without the type declarations.
for (const entry of readdirSync(distDir, { withFileTypes: true })) {
  cpSync(join(distDir, entry.name), join(stage, "server", entry.name), {
    recursive: true,
    filter: (src) => !src.endsWith(".d.ts"),
  });
}

// Production dependencies, pinned by the lockfile.
writeFileSync(
  join(stage, "server", "package.json"),
  `${JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", dependencies: pkg.dependencies }, null, 2)}\n`,
);
cpSync(join(root, "package-lock.json"), join(stage, "server", "package-lock.json"));
execFileSync(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: join(stage, "server"),
  stdio: "inherit",
});

const repo = "https://github.com/hofmeister/godaddy-mcp";
const manifest = {
  manifest_version: "0.3",
  name: "godaddy-mcp",
  display_name: "GoDaddy Account Management",
  version: pkg.version,
  description:
    "Manage the domains in your own GoDaddy account from Claude: DNS records, nameservers, availability and price quotes.",
  long_description:
    "Full access to your own GoDaddy account through your Personal Access Token: list and inspect domains, add, change and delete DNS records, re-point nameservers, check availability and get registration price quotes. Buying and renewing domains is off unless you turn on \"Allow purchases\". Community project, not affiliated with GoDaddy.",
  author: { name: "Henrik Hofmeister", url: "https://github.com/hofmeister" },
  repository: { type: "git", url: repo },
  homepage: repo,
  documentation: `${repo}#readme`,
  support: `${repo}/issues`,
  license: "MIT",
  privacy_policies: [`${repo}#privacy`],
  keywords: ["godaddy", "domains", "dns", "nameservers"],
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: {
        GODADDY_PAT: "${user_config.godaddy_pat}",
        GODADDY_API_BASE_URL: "${user_config.api_base_url}",
        GODADDY_ENABLE_PURCHASES: "${user_config.enable_purchases}",
      },
    },
  },
  user_config: {
    godaddy_pat: {
      type: "string",
      title: "GoDaddy Personal Access Token",
      description:
        "Create one at https://developer.godaddy.com/personal-access-token with the scopes for what Claude may do (see the README).",
      sensitive: true,
      required: true,
    },
    api_base_url: {
      type: "string",
      title: "GoDaddy API base URL",
      description:
        "https://api.godaddy.com (production) or https://api.ote-godaddy.com (GoDaddy's OTE test environment, no real charges).",
      required: false,
      default: "https://api.godaddy.com",
    },
    enable_purchases: {
      type: "boolean",
      title: "Allow purchases",
      description:
        "Adds register_domain and renew_domain, which charge your GoDaddy payment method. Claude asks before using them.",
      required: false,
      default: false,
    },
  },
  compatibility: {
    claude_desktop: ">=0.10.0",
    platforms: ["darwin", "win32", "linux"],
    runtimes: { node: ">=20.0.0" },
  },
};
writeFileSync(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

mkdirSync(outDir, { recursive: true });
const out = join(outDir, `godaddy-mcp-${pkg.version}.mcpb`);
rmSync(out, { force: true });
execFileSync(npx, ["--yes", "@anthropic-ai/mcpb", "pack", stage, out], { stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });
console.log(`built ${out}`);
