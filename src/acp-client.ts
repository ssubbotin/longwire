import WebSocket from "ws";
import {
  buildAuthenticatedWsUrl,
  type LongwireConfig,
} from "./config.js";
import type {
  AcpClientStatus,
  AcpInitializeResult,
  AcpPromptResult,
  AcpSessionNewResult,
  JsonRpcMessage,
  PromptAggregate,
  SessionUpdate,
  SessionUpdateNotification,
  ToolCallSummary,
} from "./types.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  method: string;
};

export type SessionUpdateHandler = (
  notification: SessionUpdateNotification,
) => void;

export interface PromptOptions {
  includeThoughts?: boolean;
  onUpdate?: SessionUpdateHandler;
}

/**
 * Minimal ACP JSON-RPC client over WebSocket for grok agent serve.
 *
 * Auth (verified against xai-org/grok-build server.rs):
 * - Preferred: Authorization: Bearer <secret>
 * - Fallback / browsers: ?server-key=<secret>
 * Endpoint path: /ws on the serve bind address.
 */
export class AcpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number | string, Pending>();
  private sessionIds = new Set<string>();
  private initialized = false;
  private lastError: string | null = null;
  private connectPromise: Promise<void> | null = null;
  private updateHandlers = new Set<SessionUpdateHandler>();
  /** Collectors keyed by sessionId while a prompt is in flight. */
  private collectors = new Map<string, SessionUpdate[]>();

  constructor(private readonly config: LongwireConfig) {}

  getStatus(): AcpClientStatus {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      initialized: this.initialized,
      sessionIds: [...this.sessionIds],
      lastError: this.lastError,
      wsUrl: this.config.wsUrl,
    };
  }

  onSessionUpdate(handler: SessionUpdateHandler): () => void {
    this.updateHandlers.add(handler);
    return () => this.updateHandlers.delete(handler);
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.openSocket()
      .then(async () => {
        await this.initialize();
      })
      .finally(() => {
        this.connectPromise = null;
      });

    return this.connectPromise;
  }

  async ensureConnected(): Promise<void> {
    await this.connect();
  }

  async disconnect(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    this.initialized = false;
    for (const [, p] of this.pending) {
      p.reject(new Error("WebSocket disconnected"));
    }
    this.pending.clear();
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      await new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        ws.close();
        setTimeout(resolve, 500);
      });
    }
  }

  async sessionNew(opts?: {
    cwd?: string;
    mcpServers?: unknown[];
    yoloMode?: boolean;
  }): Promise<AcpSessionNewResult> {
    await this.ensureConnected();
    const cwd = opts?.cwd ?? this.config.cwd;
    const result = (await this.request("session/new", {
      cwd,
      mcpServers: opts?.mcpServers ?? [],
      _meta: { yoloMode: opts?.yoloMode ?? true },
    })) as AcpSessionNewResult;

    if (!result?.sessionId) {
      throw new Error("session/new did not return sessionId");
    }
    this.sessionIds.add(result.sessionId);
    return result;
  }

  async sessionLoad(sessionId: string, cwd?: string): Promise<unknown> {
    await this.ensureConnected();
    const result = await this.request("session/load", {
      sessionId,
      cwd: cwd ?? this.config.cwd,
      mcpServers: [],
    });
    this.sessionIds.add(sessionId);
    return result;
  }

  /**
   * Send session/prompt and wait for the JSON-RPC result (turn completion).
   * Collects session/update notifications for the same session meanwhile.
   */
  async sessionPrompt(
    sessionId: string,
    text: string,
    options: PromptOptions = {},
  ): Promise<PromptAggregate> {
    await this.ensureConnected();
    const collected: SessionUpdate[] = [];
    this.collectors.set(sessionId, collected);

    const unsub = options.onUpdate
      ? this.onSessionUpdate(options.onUpdate)
      : () => {};

    try {
      const result = (await this.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      })) as AcpPromptResult;

      return aggregateUpdates(collected, result?.stopReason, options.includeThoughts);
    } finally {
      this.collectors.delete(sessionId);
      unsub();
    }
  }

  /**
   * ACP cancellation is a JSON-RPC *notification* (no response id).
   * The in-flight session/prompt then completes with stopReason "cancelled".
   */
  async sessionCancel(sessionId: string): Promise<void> {
    await this.ensureConnected();
    this.notify("session/cancel", { sessionId });
  }

  private async openSocket(): Promise<void> {
    const url = buildAuthenticatedWsUrl(this.config.wsUrl, this.config.secret);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.lastError = err.message;
        reject(err);
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        this.lastError = null;
        resolve();
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(url, {
          headers: {
            Authorization: `Bearer ${this.config.secret}`,
          },
        });
      } catch (err) {
        fail(wrapConnectError(err, this.config.wsUrl));
        return;
      }

      this.ws = ws;

      ws.on("open", () => ok());

      ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      ws.on("error", (err) => {
        const wrapped = wrapConnectError(err, this.config.wsUrl);
        this.lastError = wrapped.message;
        if (!settled) {
          fail(wrapped);
        }
      });

      ws.on("close", (code, reason) => {
        const reasonText = reason?.toString() || `code ${code}`;
        this.initialized = false;
        if (!settled) {
          fail(
            new Error(
              `WebSocket closed before open (${reasonText}). ` +
                `Check GROK_AGENT_SECRET and that the agent is serving on ${this.config.wsUrl}.`,
            ),
          );
          return;
        }
        for (const [, p] of this.pending) {
          p.reject(new Error(`WebSocket closed: ${reasonText}`));
        }
        this.pending.clear();
        this.ws = null;
      });

      ws.on("unexpected-response", (_req, res) => {
        const status = res.statusCode ?? 0;
        let msg =
          status === 401
            ? "Unauthorized (401): invalid or missing GROK_AGENT_SECRET."
            : `Unexpected HTTP ${status} during WebSocket upgrade.`;
        fail(new Error(msg));
      });
    });
  }

  private async initialize(): Promise<AcpInitializeResult> {
    const result = (await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: {
        name: "longwire",
        version: "0.1.0",
      },
    })) as AcpInitializeResult;
    this.initialized = true;
    return result;
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0" as const,
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket is not connected"));
        return;
      }
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload), (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private notify(method: string, params?: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    const payload = {
      jsonrpc: "2.0" as const,
      method,
      params,
    };
    this.ws.send(JSON.stringify(payload));
  }

  private handleMessage(raw: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      this.lastError = `Invalid JSON from agent: ${raw.slice(0, 200)}`;
      return;
    }

    if ("id" in msg && msg.id !== null && msg.id !== undefined && !("method" in msg)) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if ("error" in msg && msg.error) {
        const err = new Error(
          `ACP ${pending.method} failed: ${msg.error.message} (code ${msg.error.code})`,
        );
        this.lastError = err.message;
        pending.reject(err);
        return;
      }
      if ("result" in msg) {
        pending.resolve(msg.result);
        return;
      }
    }

    if ("method" in msg && msg.method === "session/update") {
      const params = (msg.params ?? {}) as SessionUpdateNotification;
      const update = params.update;
      if (update && params.sessionId) {
        const bucket = this.collectors.get(params.sessionId);
        if (bucket) bucket.push(update);
      }
      for (const handler of this.updateHandlers) {
        try {
          handler(params);
        } catch {
          // ignore listener errors
        }
      }
    }
  }
}

export function aggregateUpdates(
  updates: SessionUpdate[],
  stopReason?: string,
  includeThoughts = false,
): PromptAggregate {
  const textParts: string[] = [];
  const thoughtParts: string[] = [];
  const toolMap = new Map<string, ToolCallSummary>();

  for (const u of updates) {
    switch (u.sessionUpdate) {
      case "agent_message_chunk": {
        const t = u.content?.text;
        if (typeof t === "string") textParts.push(t);
        break;
      }
      case "agent_thought_chunk": {
        const t = u.content?.text;
        if (typeof t === "string") thoughtParts.push(t);
        break;
      }
      case "tool_call": {
        const id = u.toolCallId ?? `anon-${toolMap.size}`;
        toolMap.set(id, {
          toolCallId: u.toolCallId,
          title: u.title,
          kind: u.kind,
          status: u.status,
        });
        break;
      }
      case "tool_call_update": {
        const id = u.toolCallId ?? `anon-${toolMap.size}`;
        const prev = toolMap.get(id) ?? { toolCallId: u.toolCallId };
        toolMap.set(id, {
          ...prev,
          title: u.title ?? prev.title,
          kind: u.kind ?? prev.kind,
          status: u.status ?? prev.status,
        });
        break;
      }
      default:
        break;
    }
  }

  const aggregate: PromptAggregate = {
    text: textParts.join(""),
    toolCalls: [...toolMap.values()],
    stopReason,
    updates,
  };
  if (includeThoughts) {
    aggregate.thoughts = thoughtParts.join("");
  }
  return aggregate;
}

function wrapConnectError(err: unknown, wsUrl: string): Error {
  const base = err instanceof Error ? err.message : String(err);
  const lower = base.toLowerCase();
  if (
    lower.includes("econnrefused") ||
    lower.includes("connect econnrefused") ||
    lower.includes("connection refused")
  ) {
    return new Error(
      `Connection refused to ${wsUrl}. Is the agent running? ` +
        `Start with: grok agent --always-approve serve --bind 127.0.0.1:2419 --secret <token>`,
    );
  }
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return new Error(
      `Unauthorized connecting to ${wsUrl}. Check GROK_AGENT_SECRET matches the agent --secret.`,
    );
  }
  return new Error(`Failed to connect to ${wsUrl}: ${base}`);
}
