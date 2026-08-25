import { describe, expect, it } from "vitest";
import type { AssistantMessage, Part, TextPart, ToolPart } from "@opencode-ai/sdk";
import { detailFromMessages, MESSAGE_FETCH_LIMIT } from "./useSessionDetails";

const assistantMessage = (id: string): AssistantMessage => ({
  id,
  sessionID: "ses_1",
  role: "assistant",
  time: { created: 0 },
  parentID: "msg_0",
  modelID: "model",
  providerID: "provider",
  mode: "primary",
  path: { cwd: "/", root: "/" },
  cost: 0,
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
});

const textPart = (messageID: string, text: string): TextPart => ({
  id: `${messageID}_text`,
  sessionID: "ses_1",
  messageID,
  type: "text",
  text,
});

const toolPart = (
  messageID: string,
  tool: string,
  status: "completed" | "error" | "pending",
): ToolPart => ({
  id: `${messageID}_tool`,
  sessionID: "ses_1",
  messageID,
  type: "tool",
  callID: "call_1",
  tool,
  state:
    status === "completed"
      ? {
          status: "completed",
          input: {},
          output: "done",
          title: "done",
          metadata: {},
          time: { start: 0, end: 1 },
        }
      : status === "error"
        ? { status: "error", input: {}, error: "boom", time: { start: 0, end: 1 } }
        : { status: "pending", input: {}, raw: "" },
});

const withParts = (
  messageID: string,
  parts: ReadonlyArray<Part>,
): { readonly info: AssistantMessage; readonly parts: ReadonlyArray<Part> } => ({
  info: assistantMessage(messageID),
  parts,
});

describe("detailFromMessages", () => {
  it("previews the most recent message's text, not the first", () => {
    const result = detailFromMessages([
      withParts("msg_1", [textPart("msg_1", "first")]),
      withParts("msg_2", [textPart("msg_2", "most recent")]),
    ]);
    expect(result.preview).toBe("most recent");
  });

  it("skips messages with no text (e.g. a tool-only message) to find a preview", () => {
    const result = detailFromMessages([
      withParts("msg_1", [textPart("msg_1", "has text")]),
      withParts("msg_2", [toolPart("msg_2", "read", "completed")]),
    ]);
    expect(result.preview).toBe("has text");
  });

  it("truncates a long preview with an ellipsis", () => {
    const long = "x".repeat(200);
    const result = detailFromMessages([withParts("msg_1", [textPart("msg_1", long)])]);
    expect(result.preview).toHaveLength(141); // 140 chars + "…"
    expect(result.preview?.endsWith("…")).toBe(true);
  });

  it("counts completed edit/write/patch tool calls, not pending/error/other tools", () => {
    const result = detailFromMessages([
      withParts("msg_1", [
        toolPart("msg_1", "edit", "completed"),
        toolPart("msg_1", "write", "completed"),
        toolPart("msg_1", "edit", "pending"), // not counted — not completed
        toolPart("msg_1", "edit", "error"), // not counted — not completed
        toolPart("msg_1", "read", "completed"), // not counted — not an edit-family tool
      ]),
    ]);
    expect(result.editCount).toBe(2);
  });

  it("reports messageCountIsExact=true when under the fetch limit", () => {
    const messages = Array.from({ length: MESSAGE_FETCH_LIMIT - 1 }, (_, i) =>
      withParts(`msg_${i}`, []),
    );
    const result = detailFromMessages(messages);
    expect(result.messageCount).toBe(MESSAGE_FETCH_LIMIT - 1);
    expect(result.messageCountIsExact).toBe(true);
  });

  it("reports messageCountIsExact=false at the fetch limit (can't tell if more exist)", () => {
    const messages = Array.from({ length: MESSAGE_FETCH_LIMIT }, (_, i) =>
      withParts(`msg_${i}`, []),
    );
    const result = detailFromMessages(messages);
    expect(result.messageCountIsExact).toBe(false);
  });

  it("returns an undefined preview for an empty session", () => {
    const result = detailFromMessages([]);
    expect(result.preview).toBeUndefined();
    expect(result.messageCount).toBe(0);
  });
});
