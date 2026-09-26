import { describe, it, expect } from "vitest";
import { okResult, errResult, withTool } from "../src/handler.ts";
import { GodaddyApiError } from "../src/client.ts";
import { ConfigError } from "../src/config.ts";

describe("okResult", () => {
  it("serializes objects and prepends the summary", () => {
    const res = okResult({ a: 1 }, "Summary line");
    expect(res.isError).toBeUndefined();
    expect(res.content[0].type).toBe("text");
    expect(res.content[0].text).toBe('Summary line\n\n{"a":1}');
  });
});

describe("errResult", () => {
  it("formats GoDaddy API errors", () => {
    const res = errResult(
      new GodaddyApiError(409, "conflict", "dns_record_not_mutable", [
        { name: "recordId", message: "managed" },
      ]),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("409");
    expect(res.content[0].text).toContain("dns_record_not_mutable");
    expect(res.content[0].text).toContain("recordId: managed");
  });

  it("formats config errors verbatim", () => {
    const res = errResult(new ConfigError("GODADDY_PAT is not set."));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("GODADDY_PAT is not set.");
  });
});

describe("withTool", () => {
  it("passes through successful results", async () => {
    const fn = withTool(async () => okResult({ ok: true }));
    const res = await fn({} as never, {});
    expect(res.isError).toBeUndefined();
  });

  it("converts thrown errors into error results without throwing", async () => {
    const fn = withTool(async () => {
      throw new GodaddyApiError(404, "not found", "not_found");
    });
    const res = await fn({} as never, {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("404");
  });
});
