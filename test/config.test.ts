import { describe, it, expect } from "vitest";
import { loadConfig, getConfig, resetConfig, ConfigError } from "../src/config.ts";

describe("loadConfig", () => {
  it("throws ConfigError when GODADDY_PAT is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/GODADDY_PAT/);
  });

  it("trims the PAT and defaults the base URL", () => {
    const config = loadConfig({ GODADDY_PAT: "  abc123 " });
    expect(config.pat).toBe("abc123");
    expect(config.baseUrl).toBe("https://api.godaddy.com");
  });

  it("strips trailing slashes from a custom base URL", () => {
    const config = loadConfig({ GODADDY_PAT: "abc", GODADDY_API_BASE_URL: "https://x.test/" });
    expect(config.baseUrl).toBe("https://x.test");
  });

  it("caches via getConfig and resets", () => {
    const saved = process.env.GODADDY_PAT;
    delete process.env.GODADDY_PAT;
    try {
      resetConfig();
      expect(() => getConfig()).toThrow(ConfigError);
    } finally {
      if (saved !== undefined) {
        process.env.GODADDY_PAT = saved;
      }
      resetConfig();
    }
  });
});
