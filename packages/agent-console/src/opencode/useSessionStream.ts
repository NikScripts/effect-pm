/**
 * Transcript for one session — loads its existing history (`session.messages`)
 * on mount, then subscribes to the server's global SSE event stream (`/event`,
 * per-directory, not session-scoped, filtered to `sessionID`) for anything new.
 * History always applies before the live subscription starts, so past messages
 * can't land after (and out of order relative to) a message sent moments later.
 *
 * Cached (cache.ts) per session id: re-opening a session you were just in
 * paints instantly from the cached transcript while history/live reconnect
 * happen in the background, instead of a blank screen every time.
 *
 * If the SSE connection drops (network blip, backgrounded tab, a phone
 * switching networks over Tailscale) it reconnects with exponential backoff
 * instead of silently going dead until the page is reloaded — refetches
 * history on each reconnect too, self-healing any events missed while down.
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
import { transcriptCache } from "./cache";
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

export const EMPTY: Transcript = { messages: new Map(), order: [], busy: false };
const MAX_RECONNECT_DELAY_MS = 10_000;

/** @internal exported for unit tests — see useSessionStream.test.ts */
export const isRenderablePart = (part: Part): part is RenderablePart =>
  part.type === "text" || part.type === "tool";

/** @internal exported for unit tests — see useSessionStream.test.ts */
export const withRole = (
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

/** @internal exported for unit tests — see useSessionStream.test.ts */
export const withPart = (transcript: Transcript, part: RenderablePart): Transcript => {
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const useSessionStream = (
  sessionID: string | undefined,
): {
  readonly transcript: Transcript;
  readonly markBusy: () => void;
  readonly clearBusy: () => void;
} => {
  const [transcript, setTranscript] = React.useState<Transcript>(
    () => (sessionID !== undefined ? transcriptCache.get(sessionID) ?? EMPTY : EMPTY),
  );
  // A ref, not a plain closure variable — markBusy/clearBusy (called from
  // outside the effect, e.g. by the composer) and the effect's own event
  // loop both need to read/write the *same* current value, or one can
  // silently clobber the other's update with a stale snapshot.
  const currentRef = React.useRef<Transcript>(transcript);
  const sessionIdRef = React.useRef(sessionID);
  sessionIdRef.current = sessionID;

  const apply = React.useCallback((updater: (t: Transcript) => Transcript): void => {
    const next = updater(currentRef.current);
    currentRef.current = next;
    const id = sessionIdRef.current;
    if (id !== undefined) transcriptCache.set(id, next);
    setTranscript(next);
  }, []);

  React.useEffect(() => {
    if (sessionID === undefined) {
      currentRef.current = EMPTY;
      setTranscript(EMPTY);
      return;
    }
    // Instant paint from cache (covers navigating back into a session), or a
    // clean slate for one never opened before.
    const seeded = transcriptCache.get(sessionID) ?? EMPTY;
    currentRef.current = seeded;
    setTranscript(seeded);

    const controller = new AbortController();
    let cancelled = false;

    const loadHistory = async (): Promise<void> => {
      const { data: history } = await client.session.messages({
        path: { id: sessionID },
      });
      if (cancelled) return;
      apply((t) => {
        let next = t;
        for (const { info, parts } of history ?? []) {
          next = withRole(next, info.id, info.role);
          for (const part of parts) {
            if (isRenderablePart(part)) next = withPart(next, part);
          }
        }
        return next;
      });
    };

    const run = async (): Promise<void> => {
      let attempt = 0;
      while (!cancelled) {
        try {
          await loadHistory();
          const { stream } = await client.event.subscribe({
            signal: controller.signal,
          });
          attempt = 0; // reset backoff once a connection actually succeeds
          for await (const event of stream) {
            if (cancelled) return;
            if (
              event.type === "message.updated" &&
              event.properties.info.sessionID === sessionID
            ) {
              const info = event.properties.info;
              apply((t) => withRole(t, info.id, info.role));
            } else if (
              event.type === "message.part.updated" &&
              isRenderablePart(event.properties.part) &&
              event.properties.part.sessionID === sessionID
            ) {
              const part = event.properties.part;
              apply((t) => withPart(t, part));
            } else if (
              event.type === "session.idle" &&
              event.properties.sessionID === sessionID
            ) {
              apply((t) => ({ ...t, busy: false }));
            }
          }
          // Stream ended without throwing (server closed it) — treat like a
          // drop and reconnect below, same as a thrown error.
        } catch (error: unknown) {
          if (cancelled) return;
          console.error("session event stream dropped, reconnecting", error);
        }
        if (cancelled) return;
        attempt += 1;
        await sleep(Math.min(1000 * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS));
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionID, apply]);

  const markBusy = React.useCallback(() => {
    apply((t) => ({ ...t, busy: true }));
  }, [apply]);

  // For when the send request itself fails — only `session.idle` clears `busy`
  // otherwise, which never arrives if the prompt never reached the server.
  const clearBusy = React.useCallback(() => {
    apply((t) => ({ ...t, busy: false }));
  }, [apply]);

  return { transcript, markBusy, clearBusy };
};
