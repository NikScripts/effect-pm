/**
 * Live transcript for one session — subscribes to the server's global SSE event
 * stream (`/event`, per-directory, not session-scoped) and filters to `sessionID`.
 *
 * Role comes from `message.updated` events (`info.role`), not from guessing which
 * message ID the client just sent — an earlier version pre-generated a client-side
 * `messageID` to pass into `promptAsync` for exactly that purpose, but doing so
 * broke the server's turn-completion tracking (confirmed hands-on: a client-supplied
 * ID sent the session into an unbounded loop that never reached `session.idle`,
 * where the same prompt with a server-generated ID settled normally). Letting the
 * server assign every ID and reading role back off its own events avoids that
 * entirely, and is the more robust design anyway.
 *
 * Renderable parts are text (the assistant's prose) and tool calls (edit/write/read/
 * etc.) — a message is the ordered interleaving of both, not just its joined text.
 *
 * @internal
 */
import * as React from "react";
import type { Part, TextPart, ToolPart } from "@opencode-ai/sdk";
import { client } from "./client";

export type RenderablePart = TextPart | ToolPart;

export type TranscriptMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly parts: ReadonlyMap<string, RenderablePart>;
};

export type Transcript = {
  readonly messages: ReadonlyMap<string, TranscriptMessage>;
  readonly order: ReadonlyArray<string>;
  readonly busy: boolean;
};

const EMPTY: Transcript = { messages: new Map(), order: [], busy: false };

const isRenderablePart = (part: Part): part is RenderablePart =>
  part.type === "text" || part.type === "tool";

const withRole = (
  transcript: Transcript,
  messageID: string,
  role: "user" | "assistant",
): Transcript => {
  const existing = transcript.messages.get(messageID);
  const messages = new Map(transcript.messages);
  messages.set(messageID, {
    id: messageID,
    role,
    parts: existing?.parts ?? new Map(),
  });
  const order = existing === undefined
    ? [...transcript.order, messageID]
    : transcript.order;
  return { ...transcript, messages, order };
};

const withPart = (transcript: Transcript, part: RenderablePart): Transcript => {
  const existing = transcript.messages.get(part.messageID);
  // Role isn't known yet if this part arrives before its `message.updated` event —
  // default to "assistant" (the far more common ordering) and let a later
  // `message.updated` correct it via `withRole`.
  const role = existing?.role ?? "assistant";
  const parts = new Map(existing?.parts ?? []);
  parts.set(part.id, part);
  const messages = new Map(transcript.messages);
  messages.set(part.messageID, { id: part.messageID, role, parts });
  const order = existing === undefined
    ? [...transcript.order, part.messageID]
    : transcript.order;
  return { ...transcript, messages, order };
};

export const useSessionStream = (
  sessionID: string | undefined,
): {
  readonly transcript: Transcript;
  readonly markBusy: () => void;
} => {
  const [transcript, setTranscript] = React.useState<Transcript>(EMPTY);

  React.useEffect(() => {
    setTranscript(EMPTY);
    if (sessionID === undefined) return;

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      const { stream } = await client.event.subscribe({
        signal: controller.signal,
      });
      for await (const event of stream) {
        if (cancelled) return;
        if (
          event.type === "message.updated" &&
          event.properties.info.sessionID === sessionID
        ) {
          const info = event.properties.info;
          setTranscript((t) => withRole(t, info.id, info.role));
        } else if (
          event.type === "message.part.updated" &&
          isRenderablePart(event.properties.part) &&
          event.properties.part.sessionID === sessionID
        ) {
          const part = event.properties.part;
          setTranscript((t) => withPart(t, part));
        } else if (
          event.type === "session.idle" &&
          event.properties.sessionID === sessionID
        ) {
          setTranscript((t) => ({ ...t, busy: false }));
        }
      }
    })().catch((error: unknown) => {
      if (!cancelled) console.error("session event stream failed", error);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionID]);

  const markBusy = React.useCallback(() => {
    setTranscript((t) => ({ ...t, busy: true }));
  }, []);

  return { transcript, markBusy };
};
