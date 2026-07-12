/**
 * @module examples/web-dashboard/cache
 *
 * One generic localStorage cache for every resource — no per-type cache code. It stores
 * an accumulator's snapshot (`{ at, items }`) keyed by a string, so the UI can paint the
 * last-known data instantly and, when the snapshot is fresh, **skip the server history
 * query** (less load). Browser-only — a no-op in Node. JSON-serialized, so it works for
 * any plain-data resource, including custom ones.
 *
 */
import { now } from "./now";

const available = typeof localStorage !== "undefined";
const NS = "wow-dash/";

/** A cached accumulator snapshot. */
export interface CacheEntry<A> {
  readonly at: number;
  readonly items: ReadonlyArray<A>;
}

/** How long a snapshot counts as "fresh" (skip the server query within this window). */
export const FRESH_MS = 30_000;

/** Read a cached snapshot (or undefined). */
export const readCache = <A>(key: string): CacheEntry<A> | undefined => {
  if (!available) return undefined;
  try {
    const raw = localStorage.getItem(NS + key);
    return raw === null ? undefined : (JSON.parse(raw) as CacheEntry<A>);
  } catch {
    return undefined;
  }
};

const lastWrite = new Map<string, number>();

/** Persist a snapshot, throttled per key (~2s) so frequent updates don't thrash storage. */
export const writeCache = <A>(key: string, items: ReadonlyArray<A>): void => {
  if (!available) return;
  const ts = now();
  if (ts - (lastWrite.get(key) ?? 0) < 2000) return;
  lastWrite.set(key, ts);
  try {
    localStorage.setItem(NS + key, JSON.stringify({ at: ts, items } satisfies CacheEntry<A>));
  } catch {
    /* over quota — drop this write */
  }
};
