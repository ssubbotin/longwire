/** JSON-RPC 2.0 message shapes used over ACP WebSocket. */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number | string;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: number | string | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcFailure;

export interface AcpInitializeResult {
  protocolVersion?: number | string;
  agentCapabilities?: Record<string, unknown>;
  authMethods?: unknown[];
  agentInfo?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AcpSessionNewResult {
  sessionId: string;
  configOptions?: unknown[];
  [key: string]: unknown;
}

export interface AcpPromptResult {
  stopReason?: string;
  [key: string]: unknown;
}

export type SessionUpdateKind =
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "plan"
  | "usage_update"
  | string;

export interface SessionUpdate {
  sessionUpdate: SessionUpdateKind;
  content?: { type?: string; text?: string; [key: string]: unknown };
  title?: string;
  toolCallId?: string;
  kind?: string;
  status?: string;
  [key: string]: unknown;
}

export interface SessionUpdateNotification {
  sessionId?: string;
  update: SessionUpdate;
}

export interface ToolCallSummary {
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
}

export interface PromptAggregate {
  text: string;
  thoughts?: string;
  toolCalls: ToolCallSummary[];
  stopReason?: string;
  updates: SessionUpdate[];
}

export interface AcpClientStatus {
  connected: boolean;
  initialized: boolean;
  sessionIds: string[];
  lastError: string | null;
  wsUrl: string;
}
