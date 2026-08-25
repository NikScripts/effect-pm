/**
 * Per-session detail for the session list cards — message count, edit-tool-call
 * count, and a preview snippet, all derived from each session's actual message
 * history (one fetch per session, reused for all three — the preview is free),
 * plus live idle/busy/retry status from the bulk status endpoint (one call for
 * all sessions, not N).
 *
 * `Session.summary` (additions/deletions/files) looks like the obvious source
 * for this but isn't used here: it's a live diff against the session's
 * uncommitted working-tree changes, not a durable record of what the session
 * did — it goes back to zero once that work is committed (confirmed hands-on:
 * a session that genuinely edited a file showed an empty `session.diff()`
 * once the edit was committed). Message/edit counts don't have that problem.
 *
 * @internal
 */
import * as React from "react";
import type { SessionStatus } from "@opencode-ai/sdk";
import { client } from "./client";

export type SessionDetail = {
  readonly messageCount: number;
  readonly editCount: number;
  readonly status: SessionStatus["type"] | undefined;
  /** Last text part found, most recent message first — free from the same fetch. */
  readonly preview: string | undefined;
};

const EDIT_FAMILY = new Set(["edit", "write", "patch"]);
const PREVIEW_LENGTH = 140;

export const useSessionDetails = (
  sessionIds: ReadonlyArray<string>,
): ReadonlyMap<string, SessionDetail> => {
  const [details, setDetails] = React.useState<ReadonlyMap<string, SessionDetail>>(new Map());
  const key = sessionIds.join(",");

  React.useEffect(() => {
    if (sessionIds.length === 0) return;
    let cancelled = false;

    (async () => {
      const [statusResult, ...messageResults] = await Promise.all([
        client.session.status().catch(() => ({ data: undefined })),
        ...sessionIds.map((id) =>
          client.session.messages({ path: { id } }).catch(() => ({ data: undefined })),
        ),
      ]);
      if (cancelled) return;

      const statuses = statusResult.data ?? {};
      const next = new Map<string, SessionDetail>();
      sessionIds.forEach((id, i) => {
        const messages = messageResults[i]?.data ?? [];
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
            preview =
              text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
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
        next.set(id, {
          messageCount: messages.length,
          editCount,
          status: statuses[id]?.type,
          preview,
        });
      });
      setDetails(next);
    })().catch((error: unknown) => {
      if (!cancelled) console.error("session details fetch failed", error);
    });

    return () => {
      cancelled = true;
    };
    // `key` (the joined id list) is the real dependency — re-fetching on every
    // render of a fresh `sessionIds` array reference would refetch constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return details;
};
