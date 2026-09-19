import { describe, expect, it } from "vitest";
import { aggregateUpdates } from "../src/acp-client.js";
import type { SessionUpdate } from "../src/types.js";

describe("aggregateUpdates", () => {
  it("joins message chunks and summarizes tool calls", () => {
    const updates: SessionUpdate[] = [
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello " },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking..." },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "c1",
        title: "Read file",
        kind: "read",
        status: "pending",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        status: "completed",
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "world" },
      },
    ];

    const agg = aggregateUpdates(updates, "end_turn", true);
    expect(agg.text).toBe("Hello world");
    expect(agg.thoughts).toBe("thinking...");
    expect(agg.stopReason).toBe("end_turn");
    expect(agg.toolCalls).toEqual([
      {
        toolCallId: "c1",
        title: "Read file",
        kind: "read",
        status: "completed",
      },
    ]);
  });

  it("omits thoughts unless requested", () => {
    const updates: SessionUpdate[] = [
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "secret" },
      },
    ];
    const agg = aggregateUpdates(updates, "end_turn", false);
    expect(agg.thoughts).toBeUndefined();
  });
});
