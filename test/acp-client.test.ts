import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { AcpClient } from "../src/acp-client.js";

type RpcMsg = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

function startMockAgent(opts: {
  secret: string;
  behavior?: (socket: WebSocket, msg: RpcMsg) => boolean | void;
}): Promise<{ url: string; close: () => Promise<void>; authed: () => boolean }> {
  let sawAuth = false;

  return new Promise((resolve, reject) => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req: IncomingMessage, socket, head) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }

      const header = req.headers.authorization ?? "";
      const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
      const queryKey = url.searchParams.get("server-key") ?? "";
      if (bearer !== opts.secret && queryKey !== opts.secret) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      sawAuth = true;

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
        ws.on("message", (data) => {
          let msg: RpcMsg;
          try {
            msg = JSON.parse(data.toString()) as RpcMsg;
          } catch {
            return;
          }

          if (opts.behavior?.(ws, msg)) {
            return;
          }

          if (msg.method === "initialize") {
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { protocolVersion: 1, agentCapabilities: {} },
              }),
            );
            return;
          }

          if (msg.method === "session/new") {
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { sessionId: "sess-test-1" },
              }),
            );
            return;
          }

          if (msg.method === "session/load") {
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { sessionId: msg.params?.sessionId },
              }),
            );
            return;
          }

          if (msg.method === "session/prompt") {
            const sessionId = msg.params?.sessionId as string;
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: "agent_message_chunk",
                    content: { type: "text", text: "pong" },
                  },
                },
              }),
            );
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call",
                    toolCallId: "t1",
                    title: "noop",
                    status: "completed",
                  },
                },
              }),
            );
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { stopReason: "end_turn" },
              }),
            );
            return;
          }

          if (msg.method === "session/cancel") {
            // notification — no response
            return;
          }

          if (msg.id !== undefined) {
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                error: { code: -32601, message: `Method not found: ${msg.method}` },
              }),
            );
          }
        });
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${addr.port}/ws`,
        authed: () => sawAuth,
        close: () =>
          new Promise<void>((res, rej) => {
            wss.close();
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });

    server.on("error", reject);
  });
}

describe("AcpClient against mock WS", () => {
  let closer: (() => Promise<void>) | null = null;
  let client: AcpClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.disconnect();
      client = null;
    }
    if (closer) {
      await closer();
      closer = null;
    }
  });

  it("connects with Bearer + server-key, initializes, prompts", async () => {
    const mock = await startMockAgent({ secret: "test-secret" });
    closer = mock.close;

    client = new AcpClient({
      wsUrl: mock.url,
      secret: "test-secret",
      cwd: "/tmp",
    });

    await client.connect();
    expect(mock.authed()).toBe(true);
    expect(client.getStatus().connected).toBe(true);
    expect(client.getStatus().initialized).toBe(true);

    const session = await client.sessionNew();
    expect(session.sessionId).toBe("sess-test-1");

    const prompt = await client.sessionPrompt(session.sessionId, "hi", {
      includeThoughts: false,
    });
    expect(prompt.text).toBe("pong");
    expect(prompt.stopReason).toBe("end_turn");
    expect(prompt.toolCalls[0]?.toolCallId).toBe("t1");

    await client.sessionCancel(session.sessionId);
    const status = client.getStatus();
    expect(status.sessionIds).toContain("sess-test-1");
    expect(status.lastError).toBeNull();
  });

  it("rejects bad secret with clear error", async () => {
    const mock = await startMockAgent({ secret: "good" });
    closer = mock.close;

    client = new AcpClient({
      wsUrl: mock.url,
      secret: "bad",
      cwd: "/tmp",
    });

    await expect(client.connect()).rejects.toThrow(/Unauthorized|GROK_AGENT_SECRET|401/i);
  });

  it("reports connection refused clearly", async () => {
    client = new AcpClient({
      wsUrl: "ws://127.0.0.1:1/ws",
      secret: "x",
      cwd: "/tmp",
    });
    await expect(client.connect()).rejects.toThrow(/Connection refused|Failed to connect/i);
  });
});
