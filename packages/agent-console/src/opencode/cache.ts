/**
 * Module-level (not React state) caches — survive unmount/remount of the
 * components that use them, e.g. navigating list -> chat -> back to list.
 * Plain typed maps, not one generic string-keyed store, so no cast is needed
 * to read a value back out.
 *
 * Stale-while-revalidate: each consumer reads a cached value synchronously on
 * mount (instant render, no "Loading…" flash for data we already have), then
 * still fetches fresh data in the background and updates both the cache and
 * its own state when that resolves.
 *
 * @internal
 */
import type { Session } from "@opencode-ai/sdk";
import type { SessionDetail } from "./useSessionDetails";
import type { Transcript } from "./useSessionStream";

export const sessionListCache: { sessions: ReadonlyArray<Session> | undefined } = {
  sessions: undefined,
};

/**
 * Keyed by session id, storing the `Session.time.updated` the detail was
 * computed for alongside it — real invalidation, not just a blind cache: a
 * session that hasn't changed since (checked against the cheap, always-fresh
 * `session.list()` response) skips its detail refetch entirely; one that has
 * gets refetched. Avoids both "list always re-downloads everything" and
 * "list shows a permanently stale preview/count once cached."
 */
export type CachedSessionDetail = {
  readonly detail: SessionDetail;
  readonly forUpdatedAt: number;
};

export const sessionDetailCache = new Map<string, CachedSessionDetail>();

export const transcriptCache = new Map<string, Transcript>();
