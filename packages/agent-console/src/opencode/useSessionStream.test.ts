import { describe, expect, it } from "vitest";
import type { StepStartPart, TextPart, ToolPart } from "@opencode-ai/sdk";
import { EMPTY, isRenderablePart, withPart, withRole } from "./useSessionStream";

const textPart = (over: Partial<TextPart> = {}): TextPart => ({
  id: "part_1",
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "text",
  text: "hello",
  ...over,
});

describe("withRole", () => {
  it("creates a new message entry with no parts yet", () => {
    const t = withRole(EMPTY, "msg_1", "user");
    expect(t.order).toEqual(["msg_1"]);
    expect(t.messages.get("msg_1")).toEqual({
      id: "msg_1",
      role: "user",
      parts: new Map(),
    });
  });

  it("preserves existing parts when correcting a role after the fact", () => {
    const withText = withPart(EMPTY, textPart());
    const corrected = withRole(withText, "msg_1", "user");
    expect(corrected.messages.get("msg_1")?.role).toBe("user");
    expect(corrected.messages.get("msg_1")?.parts.get("part_1")).toEqual(textPart());
  });

  it("does not append to order twice for the same message id", () => {
    const once = withRole(EMPTY, "msg_1", "assistant");
    const twice = withRole(once, "msg_1", "user");
    expect(twice.order).toEqual(["msg_1"]);
  });

  it("does not touch other messages' object identity", () => {
    const base = withRole(EMPTY, "msg_1", "assistant");
    const untouched = base.messages.get("msg_1");
    const next = withRole(base, "msg_2", "user");
    // Same reference — this is what lets React.memo(MessageBubble) skip
    // re-rendering messages an event didn't touch.
    expect(next.messages.get("msg_1")).toBe(untouched);
  });
});

describe("withPart", () => {
  it("defaults role to assistant when the part arrives before message.updated", () => {
    const t = withPart(EMPTY, textPart());
    expect(t.messages.get("msg_1")?.role).toBe("assistant");
  });

  it("keeps an already-known role instead of overwriting it back to assistant", () => {
    const withUser = withRole(EMPTY, "msg_1", "user");
    const t = withPart(withUser, textPart());
    expect(t.messages.get("msg_1")?.role).toBe("user");
  });

  it("accumulates multiple parts on the same message, in arrival order", () => {
    const first = withPart(EMPTY, textPart({ id: "part_1", text: "a" }));
    const second = withPart(first, textPart({ id: "part_2", text: "b" }));
    const parts = Array.from(second.messages.get("msg_1")!.parts.values());
    expect(parts.filter((p) => p.type === "text").map((p) => p.text)).toEqual(["a", "b"]);
  });

  it("replaces a part in place by id instead of duplicating it (SSE growing-text updates)", () => {
    const first = withPart(EMPTY, textPart({ text: "hel" }));
    const second = withPart(first, textPart({ text: "hello world" }));
    const parts = Array.from(second.messages.get("msg_1")!.parts.values());
    expect(parts).toHaveLength(1);
    const [only] = parts;
    expect(only?.type === "text" ? only.text : undefined).toBe("hello world");
  });

  it("keeps other messages at the same object reference when one part updates", () => {
    const base = withPart(EMPTY, textPart({ id: "a", messageID: "msg_1" }));
    const otherMessage = base.messages.get("msg_1");
    const next = withPart(
      base,
      textPart({ id: "b", messageID: "msg_2" }),
    );
    expect(next.messages.get("msg_1")).toBe(otherMessage);
  });
});

describe("isRenderablePart", () => {
  it("accepts text and tool parts", () => {
    const tool: ToolPart = {
      id: "part_2",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool: "read",
      state: { status: "pending", input: {}, raw: "" },
    };
    expect(isRenderablePart(textPart())).toBe(true);
    expect(isRenderablePart(tool)).toBe(true);
  });

  it("rejects other part types (step markers, snapshots, etc.)", () => {
    const stepStart: StepStartPart = {
      id: "part_3",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "step-start",
    };
    expect(isRenderablePart(stepStart)).toBe(false);
  });
});
