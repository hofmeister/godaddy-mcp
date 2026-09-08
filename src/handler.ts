import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GodaddyApiError } from "./client.js";
import { ConfigError } from "./config.js";

/** Wrap an unknown tool payload into a successful text result. */
export function okResult(payload: unknown, summary?: string): CallToolResult {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    content: [{ type: "text", text: summary ? `${summary}\n\n${text}` : text }],
  };
}

/** Wrap an error into an MCP error result. */
export function errResult(err: unknown): CallToolResult {
  let text: string;
  if (err instanceof GodaddyApiError) {
    text = err.detail;
  } else if (err instanceof ConfigError) {
    text = err.message;
  } else if (err instanceof Error) {
    text = `Unexpected error: ${err.message}`;
  } else {
    text = `Unexpected error: ${String(err)}`;
  }
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Wrap a handler so that any thrown error becomes an MCP error result
 * instead of crashing the server. The second argument is the MCP request
 * context; tool handlers do not need it.
 */
export function withTool<A>(fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A, _extra?: unknown): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      return errResult(err);
    }
  };
}
