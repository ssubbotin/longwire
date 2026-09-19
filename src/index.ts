#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AcpClient } from "./acp-client.js";
import { loadConfig } from "./config.js";
import {
  cancelSchema,
  errorResult,
  handleCancel,
  handlePrompt,
  handleSessionCreate,
  handleSessionLoad,
  handleStatus,
  promptSchema,
  sessionCreateSchema,
  sessionLoadSchema,
} from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new AcpClient(config);

  const server = new McpServer({
    name: "longwire",
    version: "0.1.0",
  });

  server.tool(
    "grok_session_create",
    "Create a new ACP session on the local Grok Build agent (session/new). Returns sessionId.",
    sessionCreateSchema,
    async (args) => {
      try {
        return await handleSessionCreate(client, args);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "grok_session_load",
    "Load/resume an existing ACP session (session/load).",
    sessionLoadSchema,
    async (args) => {
      try {
        return await handleSessionLoad(client, args);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "grok_prompt",
    "Send a user prompt (session/prompt), wait for turn completion, and return aggregated agent text plus a tool-call summary. Optional includeThoughts.",
    promptSchema,
    async (args) => {
      try {
        return await handlePrompt(client, args);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "grok_cancel",
    "Cancel an in-flight prompt turn via ACP session/cancel notification. The corresponding grok_prompt call should then finish with stopReason cancelled.",
    cancelSchema,
    async (args) => {
      try {
        return await handleCancel(client, args);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "grok_status",
    "Return connection status: connected?, initialized, sessionIds, lastError, wsUrl.",
    {},
    async () => {
      try {
        return handleStatus(client);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    try {
      await client.disconnect();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
