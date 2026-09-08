# @hofmeister/godaddy-mcp

Model Context Protocol (MCP) server for the [GoDaddy Domains API](https://developer.godaddy.com). Exposes domain listing, DNS management, availability search, and domain registration as MCP tools — for use with Claude Desktop, opencode, Cursor, or any other MCP client.

Published to [GitHub Packages](https://github.com/hofmeister/godaddy-mcp/packages).

## Features

| Tool | What it does |
| --- | --- |
| `list_domains` | List domains owned by the account (status, expiration, auto-renew, privacy, transfer lock). Filters by status, lifecycle group, expiration date, and update time, with cursor pagination. |
| `get_domain` | Full detail for one domain, including `expiresAt`, `renewBy`, and `autoRenew`. |
| `renew_domain` | Renew a domain for 1–10 years (v1 API). **Charges the account.** |
| `list_dns_records` | DNS records for a zone, filterable by type and name; returns the `recordId` each record needs for updates/deletes. |
| `add_dns_record` | Add an A/AAAA/CNAME/MX/TXT/NS/SRV/CAA record. |
| `update_dns_record` | Fully replace a record by `recordId`. |
| `delete_dns_record` | Delete a record by `recordId` (irreversible). |
| `check_domain_availability` | Availability + per-term pricing for one or many domains (cached `SPEED` or live-registry `ACCURACY` checks). |
| `suggest_domains` | Available-name suggestions from a keyword query. |
| `get_registration_quote` | Lock a registration price (`quoteToken`) and return the required ICANN agreements. Read-only, no charge. |
| `register_domain` | Execute a quote with consent. **Charges the account.** Polls until the registration completes. |
| `set_nameservers` | Replace the authoritative nameservers (2–13). Polls the registry operation. |

Registration is deliberately two-step: `get_registration_quote` returns the price and the legal agreements to review, and `register_domain` only runs with the `quoteToken` and accepted `agreementTypes` from that quote.

## Prerequisites

- **Node.js 20+**
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

   Granting all four is fine — the server only calls what you ask it to.
4. Create the token and **copy it immediately** — GoDaddy shows it only once.
5. Put it somewhere safe. It is a secret, like a password: it gives whoever holds it programmatic control of your domains.

> **Account profile gotcha:** registration quotes resolve the registrant contact from your account profile. If any contact field (e.g. the city name) contains non-ASCII characters, GoDaddy rejects quotes with `422 VALIDATION_ERROR` — make the fields plain ASCII.

> **Legacy API key/secret (sso-key) pairs are not supported.** They are deprecated, cannot access the v3 registration/availability APIs, and the API will drop them.

## Installation

The repository is public, so **no tokens are needed to install it** — only the GoDaddy PAT is required later.

### From GitHub directly (recommended, no tokens)

npm can install the repository itself. The package's `prepare` script compiles the server during install, so you get a ready-to-run binary:

```bash
mkdir ~/godaddy-mcp && cd ~/godaddy-mcp
npm init -y
npm install github:hofmeister/godaddy-mcp#v0.1.0   # pin to a release tag
```

The server entry point is `node_modules/@hofmeister/godaddy-mcp/dist/index.js` — point your MCP client's `command`/`args` at it (see [MCP client configuration](#mcp-client-configuration)). The equivalent long form is `npm install git+https://github.com/hofmeister/godaddy-mcp.git#v0.1.0`, and for a one-off run: `npx github:hofmeister/godaddy-mcp`.

### From source (for development)

```bash
git clone https://github.com/hofmeister/godaddy-mcp
cd godaddy-mcp
npm install
npm run build
```

The server entry point is `dist/index.js`.

### From GitHub Packages (published builds)

The package is published to [GitHub Packages](https://github.com/hofmeister/godaddy-mcp/packages) as `@hofmeister/godaddy-mcp`. Create a **read-only** GitHub token at [github.com/settings/tokens](https://github.com/settings/tokens) — classic token with `read:packages`, or a fine-grained token with **Read** access to *Packages* on the `hofmeister` account. It grants nothing beyond reading this one public package.

Tell npm to use the GitHub registry for this scope and authenticate:

```bash
# ~/.npmrc (or a project .npmrc)
@hofmeister:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_your_github_token
```

Then install it in a folder of its own:

```bash
mkdir ~/godaddy-mcp && cd ~/godaddy-mcp
npm init -y
npm install @hofmeister/godaddy-mcp
```

The server entry point is `~/godaddy-mcp/node_modules/@hofmeister/godaddy-mcp/dist/index.js`. You can also run it ad hoc with `npx @hofmeister/godaddy-mcp`.

## Setup

```bash
export GODADDY_PAT="your-personal-access-token"
```

Environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `GODADDY_PAT` | yes | GoDaddy Personal Access Token (Bearer). |
| `GODADDY_API_BASE_URL` | no | API base URL override (default `https://api.godaddy.com`). Useful for testing. |

If `GODADDY_PAT` is missing, the server still starts; tool calls return a clear error telling you to set it.

### Verify without an MCP client

```bash
GODADDY_PAT=... npm run smoke   # read-only API smoke test
npm test                        # unit tests (no network, no credentials needed)
```

## MCP client configuration

The server speaks MCP over **stdio**. Run it with `node dist/index.js` (or `npm run dev` to run the TypeScript source via tsx).

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "godaddy": {
      "command": "node",
      "args": ["/absolute/path/to/godaddy-mcp/dist/index.js"],
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
      "command": ["node", "/absolute/path/to/godaddy-mcp/dist/index.js"],
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
      "command": "node",
      "args": ["/absolute/path/to/godaddy-mcp/dist/index.js"],
      "env": { "GODADDY_PAT": "your-personal-access-token" }
    }
  }
}
```

> **Security note:** the PAT grants programmatic control of your domains. Store it in the MCP client's env config (or a secrets manager), never in files that get committed.

## Development

```bash
npm install        # dependencies
npm run build      # compile to dist/
npm test           # vitest unit tests (mocked API, no credentials needed)
npm run dev        # run the server from source via tsx
npm run smoke      # read-only live API check (needs GODADDY_PAT)
```

## Releasing

Releases are cut by the **Release** workflow (`.github/workflows/release.yml`), which publishes to GitHub Packages and cuts a GitHub Release in one go.

**Triggering a release:** run the *Release* workflow from the Actions tab and pick `patch`, `minor`, or `major`. It works off `master`: the tests run first, then the new version is written to `package.json`, committed and tagged (`vX.Y.Z`), and the package is published from that commit. The version counts up from the newest `vX.Y.Z` tag; with no tags yet, the version already in `package.json` is released as it stands and the choice is ignored.

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

---

*This project was written by [Amber](https://2ba.ai) — a model by 2ba.ai.*
