import { z } from "zod";
import type { AcpClient } from "./acp-client.js";

export const sessionCreateSchema = {
  cwd: z
    .string()
    .optional()
    .describe("Working directory for the new ACP session (default: GROK_AGENT_CWD)"),
  yoloMode: z
    .boolean()
    .optional()
    .describe("Always-approve tool permissions for this session (default: true)"),
};

export const sessionLoadSchema = {
  sessionId: z.string().describe("Existing ACP session id to load/resume"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory associated with the session"),
};

export const promptSchema = {
  sessionId: z.string().describe("ACP session id from grok_session_create / load"),
  text: z.string().describe("User prompt text to send to the agent"),
  includeThoughts: z
    .boolean()
    .optional()
    .describe("When true, include aggregated agent_thought_chunk text"),
};

export const cancelSchema = {
  sessionId: z.string().describe("ACP session id whose in-flight turn should be cancelled"),
};

export function textResult(payload: unknown) {
  const text =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text" as const, text }],
  };
}

export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export async function handleSessionCreate(
  client: AcpClient,
  args: { cwd?: string; yoloMode?: boolean },
) {
  const result = await client.sessionNew({
    cwd: args.cwd,
    yoloMode: args.yoloMode,
  });
  return textResult({
    sessionId: result.sessionId,
    configOptions: result.configOptions,
  });
}

export async function handleSessionLoad(
  client: AcpClient,
  args: { sessionId: string; cwd?: string },
) {
  const result = await client.sessionLoad(args.sessionId, args.cwd);
  return textResult({
    sessionId: args.sessionId,
    result,
  });
}

export async function handlePrompt(
  client: AcpClient,
  args: { sessionId: string; text: string; includeThoughts?: boolean },
) {
  const aggregate = await client.sessionPrompt(args.sessionId, args.text, {
    includeThoughts: args.includeThoughts,
  });
  return textResult({
    sessionId: args.sessionId,
    stopReason: aggregate.stopReason,
    text: aggregate.text,
    ...(args.includeThoughts ? { thoughts: aggregate.thoughts ?? "" } : {}),
    toolCalls: aggregate.toolCalls,
  });
}

export async function handleCancel(
  client: AcpClient,
  args: { sessionId: string },
) {
  await client.sessionCancel(args.sessionId);
  return textResult({
    sessionId: args.sessionId,
    cancelled: true,
    note: "session/cancel notification sent; in-flight grok_prompt should complete with stopReason cancelled",
  });
}

export function handleStatus(client: AcpClient) {
  return textResult(client.getStatus());
}
