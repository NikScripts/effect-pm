/**
 * **HistoryStore** — a tiny, backend-agnostic append-log for stream history (metrics, logs, …).
 *
 * The toolkit's resource Tags expose **live** streams (`logs`, `metrics`, …). To read back what
 * *was* in those streams, a resource appends each element here (keyed by `${tag.key}/<stream>`), and
 * the matching `*History` query reads it back. Deliberately simpler than the Store bridge
 * (`Process.store` / `QueueResource.store` / …): one keyed append-log with `append` + `read`,
 * holding already-encoded JSON values so a backend just persists/returns them.
 *
 * - **`layerMemory`** — in-memory ring per stream (bounded by `capacity`). The default today.
 * - SQLite / Postgres backends land later behind the same interface (one append-only
 *   `(stream_id, ts, json)` table). See `docs/plans/README.md` (Postgres backends).
 *
 * **Optional**: resources read it via `Effect.serviceOption(HistoryStore)`, so with no layer
 * provided, `append` is a no-op and `*History` returns empty — you only pay for it when you opt in.
 *
 * @module HistoryStore
 */
import { Clock, Context, DateTime, Effect, Layer } from "effect";

/**
 * Filters for {@link HistoryStore.read} — newest `limit` entries within an optional `[since, until]`
 * window (by append time).
 *
 * @category models
 * @public
 */
export interface HistoryReadOptions {
  readonly limit?: number;
  readonly since?: DateTime.Utc;
  readonly until?: DateTime.Utc;
}

/**
 * The service shape: append an (already-encoded) entry to a stream, and read a stream back. Entries
 * are opaque (`unknown`) — callers encode/decode with their own schema; the store just persists.
 *
 * @category models
 * @public
 */
export interface HistoryStoreShape {
  readonly append: (streamId: string, entry: unknown) => Effect.Effect<void>;
  readonly read: (
    streamId: string,
    options?: HistoryReadOptions,
  ) => Effect.Effect<ReadonlyArray<unknown>>;
}

/**
 * The {@link HistoryStore} tag.
 *
 * @category context
 * @public
 */
export class HistoryStoreTag extends Context.Service<
  HistoryStoreTag,
  HistoryStoreShape
>()("@nikscripts/effect-pm/HistoryStore/HistoryStoreTag") {}

/**
 * In-memory {@link HistoryStore}: a bounded ring per stream id (oldest dropped past `capacity`).
 * Append stamps the current time so `since`/`until` filtering works.
 *
 * @public
 */
const layerMemory = (options?: {
  readonly capacity?: number;
}): Layer.Layer<HistoryStoreTag> =>
  Layer.sync(HistoryStoreTag, () => {
    const capacity = options?.capacity ?? 10_000;
    const store = new Map<
      string,
      Array<{ readonly ts: number; readonly entry: unknown }>
    >();
    return {
      append: (streamId, entry) =>
        Effect.gen(function* () {
          const ts = yield* Clock.currentTimeMillis;
          const existing = store.get(streamId) ?? [];
          existing.push({ ts, entry });
          if (existing.length > capacity) {
            existing.splice(0, existing.length - capacity);
          }
          store.set(streamId, existing);
        }),
      read: (streamId, opts) =>
        Effect.sync(() => {
          const all = store.get(streamId) ?? [];
          const since =
            opts?.since !== undefined ? DateTime.toEpochMillis(opts.since) : undefined;
          const until =
            opts?.until !== undefined ? DateTime.toEpochMillis(opts.until) : undefined;
          let window = all;
          if (since !== undefined) window = window.filter((e) => e.ts >= since);
          if (until !== undefined) window = window.filter((e) => e.ts <= until);
          if (opts?.limit !== undefined && window.length > opts.limit) {
            window = window.slice(window.length - opts.limit);
          }
          return window.map((e) => e.entry);
        }),
    };
  });

/**
 * History store — a keyed append-log for stream history. `yield* HistoryStore` for the service;
 * `HistoryStore.layerMemory()` to provide the in-memory backend.
 *
 * @category context
 * @public
 */
export const HistoryStore = Object.assign(HistoryStoreTag, {
  layerMemory,
});
