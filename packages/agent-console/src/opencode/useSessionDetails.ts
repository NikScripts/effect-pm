/**
 * Per-session detail for the session list cards — message count, edit-tool-call
 * count, and a preview snippet, plus live idle/busy/retry status from the bulk
 * status endpoint (one call for all sessions, not N).
 *
 * `Session.summary` (additions/deletions/files) looks like the obvious source
 * for count/preview data but isn't used here: it's a live diff against the
 * session's uncommitted working-tree changes, not a durable record of what the
 * session did — it goes back to zero once that work is committed (confirmed
 * hands-on: a session that genuinely edited a file showed an empty
 * `session.diff()` once the edit was committed). Message/edit counts don't
 * have that problem.
 *
 * Every session's messages are fetched with `limit: MESSAGE_FETCH_LIMIT`, not
 * unbounded — confirmed hands-on this matters a lot, not just in theory: one
 * session in this list has only 13 messages but a 374KB unbounded payload
 * (tool-call outputs, e.g. a `read` dumping a whole file, are large).
 * Downloading that for every session just to show a count and a one-line
 * preview doesn't scale. `limit` returns the *most recent* N messages
 * (confirmed against the same session: `limit=3`'s last entries exactly
 * match the unbounded response's last 3), which is exactly what a preview
 * needs — the tradeoff is `messageCount`/`editCount` become "in the last N"
 * rather than a true lifetime total for sessions longer than the limit;
 * `messageCountIsExact` says which case a given session is in so the UI can
 * render "20+" honestly instead of silently understating a real total.
 *
 * Cached (cache.ts) per session id, invalidated per session against its own
 * `Session.time.updated` (always fresh from the cheap `session.list()` call) —
 * a session that hasn't changed since its detail was last fetched is served
 * from cache with no request at all, instead of re-downloading the whole
 * list's detail on every visit to the session list.
 *
 * @internal
 */
import * as React from "react";
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk";
import { type CachedSessionDetail, sessionDetailCache } from "./cache";
import { client } from "./client";

export type SessionDetail = {
  readonly messageCount: number;
  readonly messageCountIsExact: boolean;
  readonly editCount: number;
  readonly status: SessionStatus["type"] | undefined;
  /** Last text part found, most recent message first — from the same fetch. */
  readonly preview: string | undefined;
};

const EDIT_FAMILY = new Set(["edit", "write", "patch"]);
const PREVIEW_LENGTH = 140;
const MESSAGE_FETCH_LIMIT = 20;

const detailFromMessages = (
  messages: ReadonlyArray<{ readonly info: Message; readonly parts: ReadonlyArray<Part> }>,
): Omit<SessionDetail, "status"> => {
  let editCount = 0;
  let preview: string | undefined;
  // Walk newest-first: the most recent message's text is the preview.
  for (let m = messages.length - 1; m >= 0; m--) {
    const { parts } = messages[m]!;
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim();
    if (preview === undefined && text.length > 0) {
      preview = text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
    }
    for (const part of parts) {
      if (
        part.type === "tool" &&
        EDIT_FAMILY.has(part.tool) &&
        part.state.status === "completed"
      ) {
        editCount += 1;
      }
    }
  }
  return {
    messageCount: messages.length,
    messageCountIsExact: messages.length < MESSAGE_FETCH_LIMIT,
    editCount,
    preview,
  };
};

export const useSessionDetails = (
  sessions: ReadonlyArray<Session>,
): ReadonlyMap<string, SessionDetail> => {
  const buildFromCache = (): ReadonlyMap<string, SessionDetail> => {
    const map = new Map<string, SessionDetail>();
    for (const session of sessions) {
      const cached = sessionDetailCache.get(session.id);
      if (cached !== undefined && cached.forUpdatedAt === session.time.updated) {
        map.set(session.id, cached.detail);
      }
    }
    return map;
  };

  const [details, setDetails] = React.useState<ReadonlyMap<string, SessionDetail>>(buildFromCache);
  const key = sessions.map((s) => `${s.id}:${s.time.updated}`).join(",");

  React.useEffect(() => {
    if (sessions.length === 0) return;
    // Seed from cache immediately — instant render for anything unchanged
    // since we last fetched it, even across a full unmount/remount.
    setDetails(buildFromCache());

    const stale = sessions.filter((session) => {
      const cached = sessionDetailCache.get(session.id);
      return cached === undefined || cached.forUpdatedAt !== session.time.updated;
    });

    let cancelled = false;

    (async () => {
      // Status is live/real-time by nature — always fetched fresh, cheap
      // (one bulk call), never cached.
      const [statusResult, ...messageResults] = await Promise.all([
        client.session.status().catch(() => ({ data: undefined })),
        ...stale.map((session) =>
          client.session
            .messages({ path: { id: session.id }, query: { limit: MESSAGE_FETCH_LIMIT } })
            .catch(() => ({ data: undefined })),
        ),
      ]);
      if (cancelled) return;

      const statuses = statusResult.data ?? {};
      setDetails((current) => {
        const next = new Map(current);
        stale.forEach((session, i) => {
          const messages = messageResults[i]?.data ?? [];
          const computed = detailFromMessages(messages);
          const detail: SessionDetail = { ...computed, status: statuses[session.id]?.type };
          const cacheEntry: CachedSessionDetail = { detail, forUpdatedAt: session.time.updated };
          sessionDetailCache.set(session.id, cacheEntry);
          next.set(session.id, detail);
        });
        // Live status can change for non-stale (cached) sessions too — apply
        // it without re-fetching their messages.
        for (const session of sessions) {
          const liveStatus = statuses[session.id]?.type;
          const existing = next.get(session.id);
          if (existing !== undefined && existing.status !== liveStatus) {
            next.set(session.id, { ...existing, status: liveStatus });
          }
        }
        return next;
      });
    })().catch((error: unknown) => {
      if (!cancelled) console.error("session details fetch failed", error);
    });

    return () => {
      cancelled = true;
    };
    // `key` encodes every session's id + time.updated — the real dependency;
    // re-running on every fresh `sessions` array reference would refetch
    // constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return details;
};
