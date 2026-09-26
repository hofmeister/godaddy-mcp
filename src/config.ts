export interface GodaddyConfig {
  /** Personal Access Token used as the Bearer credential. */
  readonly pat: string;
  /** API base URL without a trailing slash. */
  readonly baseUrl: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_BASE_URL = "https://api.godaddy.com";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GodaddyConfig {
  const pat = env.GODADDY_PAT?.trim();
  if (!pat) {
    throw new ConfigError(
      "GODADDY_PAT is not set. Create a Personal Access Token at https://developer.godaddy.com/personal-access-token (scopes: domains.domain:read, domains.dns:update, domains.domain:create) and set the GODADDY_PAT environment variable before starting this server.",
    );
  }
  const baseUrl = (env.GODADDY_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { pat, baseUrl };
}

let cached: GodaddyConfig | undefined;

export function getConfig(): GodaddyConfig {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
}

/** Test hook: forget the cached config. */
export function resetConfig(): void {
  cached = undefined;
}
