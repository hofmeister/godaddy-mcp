# GoDaddy Account Management for Claude

Manage the domains in your own GoDaddy account from a conversation with Claude: list your domains, add or change DNS records, check which names are free and what they cost, and re-point domains. It is a Claude plugin that runs a local Model Context Protocol (MCP) server for the [GoDaddy Domains API](https://developer.godaddy.com), and the same server works with Claude Desktop, opencode, Cursor, or any other MCP client.

This is a community project. It is not made, endorsed or supported by GoDaddy. Unlike GoDaddy's own connector in the Claude directory, it works with **full access to your account** through your Personal Access Token: it can change and delete DNS records and re-point nameservers. Grant the token only the scopes you want Claude to have (see [How to get a GoDaddy PAT](#how-to-get-a-godaddy-pat)).

## Use it with Claude

Once installed, ask for what you want in plain language:

- "Which of my domains expire in the next three months?"
- "Point `www.example.com` at `203.0.113.10` and add an SPF record for Google Workspace."
- "Is `bakery-copenhagen.com` available, and what would it cost for two years?"
- "Move `example.org` to Cloudflare's nameservers `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com`."

Claude reads before it writes, and anything that cannot be undone (`delete_dns_record`, `update_dns_record`, `set_nameservers`) is marked destructive, so Claude asks you before it runs it.

**The plugin never spends money.** Buying and renewing domains stay on godaddy.com: Claude can check availability and get a price quote, and you complete the purchase there. The server has `register_domain` and `renew_domain` tools for other MCP clients, but they exist only when `GODADDY_ENABLE_PURCHASES=1` is set, and the plugin always starts the server with it off (Anthropic's directory does not list software that executes financial transactions).

### Install the plugin in Claude Code

```bash
claude plugin marketplace add hofmeister/godaddy-mcp
claude plugin install godaddy-account-management@godaddy-account-management
```

Claude Code asks for two settings when the plugin is enabled:

- **GoDaddy Personal Access Token** (required, stored in your system's secure credential store) — see [How to get a GoDaddy PAT](#how-to-get-a-godaddy-pat).
- **GoDaddy API base URL** — `https://api.godaddy.com` (default) or `https://api.ote-godaddy.com` for GoDaddy's OTE test environment.

The plugin starts the server with your own `node` (22.18 or newer) straight from the TypeScript source in this repository; Claude Code installs its two runtime dependencies from `package-lock.json` when you install the plugin. Nothing is built or downloaded at start-up.

The server is also published to [GitHub Packages](https://github.com/hofmeister/godaddy-mcp/packages) for other MCP clients; see [Installation](#installation).

## Features

| Tool | What it does |
| --- | --- |
| `list_domains` | List domains owned by the account (status, expiration, auto-renew, privacy, transfer lock). Filters by status, lifecycle group, expiration date, and update time, with cursor pagination. |
| `get_domain` | Full detail for one domain, including `expiresAt`, `renewBy`, and `autoRenew`. |
| `renew_domain` | Renew a domain for 1–10 years (v1 API). **Charges the account.** Only with `GODADDY_ENABLE_PURCHASES=1`; never in the plugin. |
| `list_dns_records` | DNS records for a zone, filterable by type and name; returns the `recordId` each record needs for updates/deletes. |
| `add_dns_record` | Add an A/AAAA/CNAME/MX/TXT/NS/SRV/CAA record. |
| `update_dns_record` | Fully replace a record by `recordId`. |
| `delete_dns_record` | Delete a record by `recordId` (irreversible). |
| `check_domain_availability` | Availability + per-term pricing for one or many domains (cached `SPEED` or live-registry `ACCURACY` checks). |
| `suggest_domains` | Available-name suggestions from a keyword query. |
| `get_registration_quote` | Lock a registration price (`quoteToken`) and return the required ICANN agreements. Read-only, no charge. |
| `register_domain` | Execute a quote with consent. **Charges the account.** Polls until the registration completes. Only with `GODADDY_ENABLE_PURCHASES=1`; never in the plugin. |
| `set_nameservers` | Replace the authoritative nameservers (2–13). Polls the registry operation. |

When purchases are enabled, registration is deliberately two-step: `get_registration_quote` returns the price and the legal agreements to review, and `register_domain` only runs with the `quoteToken` and accepted `agreementTypes` from that quote.

## Prerequisites

- **Node.js 22.18+** (it runs the TypeScript source directly)
- A GoDaddy account (read operations work on any account; registration/renewal additionally need a **payment method on file** and a complete **registrant contact**)
- A **Personal Access Token (PAT)** — see below

### How to get a GoDaddy PAT

1. Sign in at GoDaddy, then open the [Personal Access Token dashboard](https://developer.godaddy.com/personal-access-token) (you can also get there from the GoDaddy dashboard via **Developer Tools → API Tokens**, or by visiting the [developer docs](https://developer.godaddy.com/docs/api-users/auth/how-to)).
2. Click **Create token** (or the equivalent "New token" button), give it a name (e.g. `mcp-server`), and set an expiry if you like (optional).
3. Select the scopes the server needs:

   | Scope | Required for |
   | --- | --- |
   | `domains.domain:read` | `list_domains`, `get_domain`, `list_dns_records`, `check_domain_availability`, `suggest_domains` |
   | `domains.dns:update` | `add_dns_record`, `update_dns_record`, `delete_dns_record` |
   | `domains.domain:create` | `get_registration_quote`, `register_domain` |
   | `domains.nameserver:update` | `set_nameservers` |

   Grant only the scopes for what you want Claude to be able to do: tools outside the token's scopes fail with GoDaddy's `403` error and change nothing.
4. Create the token and **copy it immediately** — GoDaddy shows it only once.
5. Put it somewhere safe. It is a secret, like a password: it gives whoever holds it programmatic control of your domains.

> **Account profile gotcha:** registration quotes resolve the registrant contact from your account profile. If any contact field (e.g. the city name) contains non-ASCII characters, GoDaddy rejects quotes with `422 VALIDATION_ERROR` — make the fields plain ASCII.

> **Legacy API key/secret (sso-key) pairs are not supported.** They are deprecated, cannot access the v3 registration/availability APIs, and the API will drop them.

## Installation

This section is for MCP clients other than the Claude plugin above.

The repository is public, so **no GitHub tokens are needed** — npx clones, builds, and runs the server for you:

```bash
npx -y github:hofmeister/godaddy-mcp
```

The first run takes about a minute (clone + `npm install` + build); afterwards npx serves it from its cache (`~/.npm/_npx`) and starts in seconds. `GODADDY_PAT` (see [Setup](#setup)) is the only secret involved.

- **Pin a version:** `npx -y github:hofmeister/godaddy-mcp#v0.1.0` (once release tags exist).
- **Stale cache:** npx caches git dependencies; if an update doesn't show up, run `npm cache clean --force` or use the pinned tag.

### Alternatives

- **From source** (development): `git clone https://github.com/hofmeister/godaddy-mcp`, then `npm install && npm run build` — the entry point is `dist/index.js`.
- **GitHub Packages:** after the first release, `@hofmeister/godaddy-mcp` is available on [GitHub Packages](https://github.com/hofmeister/godaddy-mcp/packages). It requires a read-only GitHub token in `.npmrc` (a GitHub-registry requirement, not a repository one), so prefer npx.

## Setup

```bash
export GODADDY_PAT="your-personal-access-token"
```

Environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `GODADDY_PAT` | yes | GoDaddy Personal Access Token (Bearer). |
| `GODADDY_API_BASE_URL` | no | API base URL override (default `https://api.godaddy.com`). Useful for testing. |
| `GODADDY_ENABLE_PURCHASES` | no | `1` exposes `register_domain` and `renew_domain`, which charge the account. Off by default, and always off in the Claude plugin. |

If `GODADDY_PAT` is missing, the server still starts; tool calls return a clear error telling you to set it.

### Verify without an MCP client

Both commands run in a [source checkout](#alternatives):

```bash
GODADDY_PAT=... npm run smoke   # read-only API smoke test
npm test                        # unit tests (no network, no credentials needed)
```

## MCP client configuration

The server speaks MCP over **stdio**; each client launches it with `npx -y github:hofmeister/godaddy-mcp`, which handles installing and building automatically. The first launch takes about a minute while npx fetches the repository — that is normal, do not kill the client.

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "godaddy": {
      "command": "npx",
      "args": ["-y", "github:hofmeister/godaddy-mcp"],
      "env": {
        "GODADDY_PAT": "your-personal-access-token"
      }
    }
  }
}
```

### opencode (`opencode.json`)

```json
{
  "mcp": {
    "godaddy": {
      "type": "local",
      "command": ["npx", "-y", "github:hofmeister/godaddy-mcp"],
      "enabled": true,
      "environment": {
        "GODADDY_PAT": "your-personal-access-token"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "godaddy": {
      "command": "npx",
      "args": ["-y", "github:hofmeister/godaddy-mcp"],
      "env": { "GODADDY_PAT": "your-personal-access-token" }
    }
  }
}
```

> **PATH note:** desktop apps inherit a minimal PATH. If the client cannot find `npx` (e.g. Node is managed by nvm), use its absolute path as `command` (such as `/opt/homebrew/bin/npx`) — or fall back to `node` with the absolute path to `dist/index.js` from a [source install](#alternatives).

> **Security note:** the PAT grants programmatic control of your domains. Store it in the MCP client's env config (or a secrets manager), never in files that get committed.

## Privacy

This plugin runs entirely on your computer. It has no server of its own, collects no analytics or telemetry, and sends nothing to its author or to Anthropic.

- **What it sends, and where:** each tool call makes HTTPS requests to the GoDaddy API you chose (`api.godaddy.com`, or `api.ote-godaddy.com` for OTE), authenticated with your Personal Access Token. Requests contain only what the tool needs: domain names, DNS records you ask to create or change, search keywords, and — for registrations, which only exist outside the plugin with `GODADDY_ENABLE_PURCHASES=1` — the quote token and the agreements you accepted. Registrant contact details come from your GoDaddy account profile on GoDaddy's side; the plugin does not send them.
- **What it stores:** nothing. The token is kept by Claude Code in your system's secure credential store (or by your MCP client's configuration) and is held only in the server's memory while it runs. The server writes no files, caches or logs.
- **Third parties:** GoDaddy receives the requests above and handles them under the [GoDaddy privacy policy](https://www.godaddy.com/legal/agreements/privacy-policy). Tool results go back to Claude as part of your conversation, where Anthropic's policies apply. Nothing is shared with anyone else.
- **Retention:** the plugin retains nothing after the server stops. GoDaddy retains account and domain data under its own policy.
- **Contact:** open an issue at [github.com/hofmeister/godaddy-mcp/issues](https://github.com/hofmeister/godaddy-mcp/issues) for questions about privacy or security.

## Development

```bash
npm install        # dependencies
npm run build      # compile to dist/
npm test           # vitest unit tests (mocked API, no credentials needed)
npm run dev        # run the server from source (Node's built-in TypeScript support)
npm run smoke      # read-only live API check (needs GODADDY_PAT)
```

To try your working copy as a Claude plugin, run `claude --plugin-dir .` from the repository root, and `claude plugin validate .` before you push.

## Releasing

Releases are cut by the **Release** workflow (`.github/workflows/release.yml`), which publishes to GitHub Packages and cuts a GitHub Release in one go.

**Triggering a release:** run the *Release* workflow from the Actions tab and pick `patch`, `minor`, or `major`. It works off `master`: the tests run first, then the new version is written to `package.json` and `.claude-plugin/plugin.json`, committed and tagged (`vX.Y.Z`), and the package is published from that commit. The version counts up from the newest `vX.Y.Z` tag; with no tags yet, the version already in `package.json` is released as it stands and the choice is ignored.

Pushing a tag `vX.Y.Z` that matches the version in `package.json` also releases the commit the tag points at.

The versioning logic lives in `scripts/version.mjs` (no dependencies, unit-testable):

```bash
node scripts/version.mjs --bump patch          # print the next version
node scripts/version.mjs --bump minor --write  # and write it to package.json
```

## Error handling

All GoDaddy API errors are surfaced to the LLM with the HTTP status, the GoDaddy `code`, and per-field details (e.g. `422 QUOTE_MISMATCH`, `409 dns_record_not_mutable` on GoDaddy-managed SOA/NS records), so agents can correct themselves. Rate limits (`429`) report the `Retry-After` seconds.

## Notes & limits

- Prices are returned by GoDaddy in cents and are converted to whole currency units in tool output.
- `register_domain` waits up to ~90s for the async registration to reach a terminal state; if it's still executing it reports `EXECUTING` — verify later with `get_domain`.
- GoDaddy rate limits API calls per credential (60 requests/minute); avoid hammering the API from tools.
- The legacy key/secret (`sso-key`) credentials are not supported: they are deprecated and cannot access the v3 registration/availability APIs.

## Support

Report bugs and ask questions at [github.com/hofmeister/godaddy-mcp/issues](https://github.com/hofmeister/godaddy-mcp/issues). Report security vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).

---

*This project was written by [Amber](https://2ba.ai) — a model by 2ba.ai.*
