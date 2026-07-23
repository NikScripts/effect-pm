/**
 * Engine schedule primitive — centralized run-window storage + controls that the `Daemon`
 * supervisor watches. **Internal**: the public face lives on the `Daemon` namespace
 * (`Daemon.scheduleInMemory` / `Daemon.scheduleDefine`, the `Daemon.ScheduleService` /
 * `Daemon.ScheduleEntry` types, the `Daemon.at` / `Daemon.window` window builders, and the
 * toolkit `Daemon.Schedule` resource). Not exported from the barrel and carries no subpath.
 *
 * A process schedule defines when run instances should be spawned. Each entry has a `startAt`
 * time and optional `stopAt` (the run window). The supervisor watches this service for changes
 * and manages trigger fibers.
 *
 * ## Core operations
 *
 * | Method | Purpose |
 * |--------|---------|
 * | `entries` | Read all current entries |
 * | `changed` | Block until the next mutation |
 * | `get` | Lookup entry by id |
 * | `has` | Check if entry exists |
 * | `add` | Append an entry |
 * | `upsert` | Insert or update by id |
 * | `remove` | Delete by id |
 * | `removeMany` | Delete multiple by id |
 * | `set` | Replace all entries |
 * | `clear` | Remove all entries |
 * | `reconcile` | Diff-based sync from external source (DB) |
 *
 * @module internal/daemonSchedule
 * @internal
 */

import { Context, DateTime, Deferred, Effect, Layer, Option, Ref } from "effect";
import { registerScheduleLayer } from "./daemonLayerBrand";

// ============================================================================
// Public Types
// ============================================================================

/**
 * One scheduled run window for a process.
 *
 * @public
 */
export interface DaemonScheduleEntry {
  /** Stable identity for this entry. Used for CRUD, reconcile, and removal cleanup. */
  readonly id: Option.Option<string>;
  /** When the run instance should be triggered. */
  readonly startAt: Date;
  /** When the run instance should stop (open-ended if absent). */
  readonly stopAt: Option.Option<Date>;
}

/**
 * Result of a `reconcile` operation — shows what changed.
 *
 * @public
 */
export interface ReconcileResult {
  readonly added: ReadonlyArray<string>;
  readonly updated: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly unchanged: ReadonlyArray<string>;
}

/**
 * Schedule service used by process runtimes and control APIs.
 *
 * @public
 */
export interface DaemonScheduleService {
  /** Read all current entries (sorted by startAt). */
  readonly entries: Effect.Effect<ReadonlyArray<DaemonScheduleEntry>>;
  /** Block until the next mutation occurs. */
  readonly changed: Effect.Effect<void>;

  // ─── Lookup ───
  /** Get entry by id. Returns None if not found or entry has no id. */
  readonly get: (id: string) => Effect.Effect<Option.Option<DaemonScheduleEntry>>;
  /** Check if an entry with given id exists. */
  readonly has: (id: string) => Effect.Effect<boolean>;

  // ─── Mutate ───
  /** Replace all entries (triggers changed). */
  readonly set: (entries: ReadonlyArray<DaemonScheduleEntry>) => Effect.Effect<void>;
  /** Append an entry (triggers changed). */
  readonly add: (entry: DaemonScheduleEntry) => Effect.Effect<void>;
  /** Insert or update by id (triggers changed). */
  readonly upsert: (entry: DaemonScheduleEntry) => Effect.Effect<void>;
  /** Remove entry by id. Returns true if found and removed. */
  readonly remove: (id: string) => Effect.Effect<boolean>;
  /** Remove multiple entries by id. Returns count removed. */
  readonly removeMany: (ids: ReadonlyArray<string>) => Effect.Effect<number>;
  /** Remove all entries (triggers changed). */
  readonly clear: Effect.Effect<void>;

  // ─── Sync ───
  /**
   * Diff-based sync: compute what's added/updated/removed/unchanged
   * relative to the provided entries. Applies the diff atomically.
   * Entries without ids are matched by reference only.
   */
  readonly reconcile: (
    next: ReadonlyArray<DaemonScheduleEntry>,
  ) => Effect.Effect<ReconcileResult>;
}

/**
 * Context tag for the DaemonSchedule service.
 *
 * @public
 */
export class DaemonScheduleTag extends Context.Service<
  DaemonScheduleTag,
  DaemonScheduleService
>()("hyperlink-ts/internal/daemonSchedule/DaemonScheduleTag") {}

// ============================================================================
// Internal: sorting and normalization
// ============================================================================

const sortEntries = (
  entries: ReadonlyArray<DaemonScheduleEntry>,
): ReadonlyArray<DaemonScheduleEntry> =>
  [...entries].sort((a, b) => {
    const byStart = a.startAt.getTime() - b.startAt.getTime();
    if (byStart !== 0) return byStart;
    const aStop = Option.match(a.stopAt, { onNone: () => Infinity, onSome: (d) => d.getTime() });
    const bStop = Option.match(b.stopAt, { onNone: () => Infinity, onSome: (d) => d.getTime() });
    return aStop - bStop;
  });

const getEntryId = (entry: DaemonScheduleEntry): string | undefined =>
  Option.getOrUndefined(entry.id);

const entriesById = (
  entries: ReadonlyArray<DaemonScheduleEntry>,
): Map<string, DaemonScheduleEntry> => {
  const byId = new Map<string, DaemonScheduleEntry>();
  for (const entry of entries) {
    const id = getEntryId(entry);
    if (id !== undefined) {
      byId.set(id, entry);
    }
  }
  return byId;
};

// ============================================================================
// Internal: in-memory implementation
// ============================================================================

const buildInMemoryService = (
  initial: ReadonlyArray<DaemonScheduleEntry>,
): Effect.Effect<DaemonScheduleService> =>
  Effect.gen(function* () {
    const entriesRef = yield* Ref.make<ReadonlyArray<DaemonScheduleEntry>>(sortEntries(initial));
    const changeSignal = yield* Ref.make<Deferred.Deferred<void, never>>(Deferred.makeUnsafe());

    // Notify subscribers that a mutation occurred
    const notify = Effect.gen(function* () {
      const current = yield* Ref.get(changeSignal);
      yield* Deferred.succeed(current, undefined);
      yield* Ref.set(changeSignal, Deferred.makeUnsafe());
    });

    // Core setter: normalize + notify
    const setEntries = (next: ReadonlyArray<DaemonScheduleEntry>) =>
      Ref.set(entriesRef, sortEntries(next)).pipe(Effect.andThen(notify));

    const mutateEntries = <A>(
      mutation: (current: ReadonlyArray<DaemonScheduleEntry>) => {
        readonly entries: ReadonlyArray<DaemonScheduleEntry>;
        readonly changed: boolean;
        readonly value: A;
      },
    ): Effect.Effect<A> =>
      Effect.flatMap(Ref.get(entriesRef), (current) => {
        const result = mutation(current);
        if (!result.changed) {
          return Effect.succeed(result.value);
        }
        return Effect.as(setEntries(result.entries), result.value);
      });

    return {
      entries: Ref.get(entriesRef),

      changed: Effect.flatMap(Ref.get(changeSignal), Deferred.await),

      get: (id) =>
        Effect.map(Ref.get(entriesRef), (all) => {
          const found = all.find((e) => getEntryId(e) === id);
          return found !== undefined ? Option.some(found) : Option.none();
        }),

      has: (id) =>
        Effect.map(Ref.get(entriesRef), (all) =>
          all.some((e) => getEntryId(e) === id),
        ),

      set: (entries) => setEntries(entries),

      add: (entry) =>
        mutateEntries((current) => ({
          entries: [...current, entry],
          changed: true,
          value: undefined,
        })),

      upsert: (entry) =>
        mutateEntries((current) => {
          const id = getEntryId(entry);
          if (id === undefined) {
            return {
              entries: [...current, entry],
              changed: true,
              value: undefined,
            };
          }
          const filtered = current.filter((e) => getEntryId(e) !== id);
          return {
            entries: [...filtered, entry],
            changed: true,
            value: undefined,
          };
        }),

      remove: (id) =>
        mutateEntries((current) => {
          const before = current.length;
          const filtered = current.filter((e) => getEntryId(e) !== id);
          const removed = filtered.length !== before;
          return {
            entries: filtered,
            changed: removed,
            value: removed,
          };
        }),

      removeMany: (ids) =>
        mutateEntries((current) => {
          const idSet = new Set(ids);
          const filtered = current.filter((e) => {
            const eid = getEntryId(e);
            return eid === undefined || !idSet.has(eid);
          });
          const removed = current.length - filtered.length;
          return {
            entries: filtered,
            changed: removed > 0,
            value: removed,
          };
        }),

      clear: setEntries([]),

      reconcile: (next) =>
        Effect.flatMap(Ref.get(entriesRef), (current) => {
          const currentById = entriesById(current);
          const nextById = entriesById(next);

          const added: Array<string> = [];
          const updated: Array<string> = [];
          const unchanged: Array<string> = [];
          const removed: Array<string> = [];

          // Entries in next: added or updated
          for (const [id, entry] of nextById) {
            const existing = currentById.get(id);
            if (existing === undefined) {
              added.push(id);
            } else if (
              existing.startAt.getTime() !== entry.startAt.getTime() ||
              Option.getOrNull(existing.stopAt)?.getTime() !== Option.getOrNull(entry.stopAt)?.getTime()
            ) {
              updated.push(id);
            } else {
              unchanged.push(id);
            }
          }

          // Entries in current but not in next: removed
          for (const id of currentById.keys()) {
            if (!nextById.has(id)) {
              removed.push(id);
            }
          }

          const result: ReconcileResult = { added, updated, removed, unchanged };
          return Effect.as(setEntries([...next]), result);
        }),
    } satisfies DaemonScheduleService;
  });

// ============================================================================
// Layer builders
// ============================================================================

const inMemoryLayer = (
  initial: ReadonlyArray<DaemonScheduleEntry> = [],
): Layer.Layer<DaemonScheduleTag> =>
  registerScheduleLayer(
    Layer.effect(DaemonScheduleTag, buildInMemoryService(initial)),
  );

// ============================================================================
// Entry constructors (convenience)
// ============================================================================

const toId = (id: string | undefined): Option.Option<string> =>
  id === undefined ? Option.none() : Option.some(id);

/** Create an open-ended entry (no stop time). */
function at(startAt: Date): DaemonScheduleEntry;
function at(id: string, startAt: Date): DaemonScheduleEntry;
function at(idOrStartAt: string | Date, maybeStartAt?: Date): DaemonScheduleEntry {
  if (idOrStartAt instanceof Date) {
    return { id: Option.none(), startAt: idOrStartAt, stopAt: Option.none() };
  }
  if (maybeStartAt === undefined) {
    throw new Error("DaemonSchedule.at(id, startAt): startAt is required");
  }
  return { id: toId(idOrStartAt), startAt: maybeStartAt, stopAt: Option.none() };
}

/** Create a windowed entry (start + stop). */
function window(startAt: Date, stopAt: Date): DaemonScheduleEntry;
function window(id: string, startAt: Date, stopAt: Date): DaemonScheduleEntry;
function window(
  idOrStartAt: string | Date,
  startAtOrStopAt: Date,
  maybeStopAt?: Date,
): DaemonScheduleEntry {
  if (idOrStartAt instanceof Date) {
    return { id: Option.none(), startAt: idOrStartAt, stopAt: Option.some(startAtOrStopAt) };
  }
  if (maybeStopAt === undefined) {
    throw new Error("DaemonSchedule.window(id, startAt, stopAt): stopAt is required");
  }
  return { id: toId(idOrStartAt), startAt: startAtOrStopAt, stopAt: Option.some(maybeStopAt) };
}

/** Create entries from bare Date starts (no ids, no stop times). */
const fromStarts = (starts: ReadonlyArray<Date>): ReadonlyArray<DaemonScheduleEntry> =>
  starts.map((startAt) => at(startAt));

/**
 * Empty in-memory schedule store.
 *
 * Use when the driver may run but no entry covers "now" until you `set`, `add`,
 * `reconcile`, or populate entries via a schedule initializer on `Daemon.make`.
 *
 * Equivalent to `DaemonSchedule.inMemory()` with no initial entries.
 */
const empty: Layer.Layer<DaemonScheduleTag> = inMemoryLayer([]);

/** Always-armed: single entry starting at epoch, never stops. */
const alwaysArmed: Layer.Layer<DaemonScheduleTag> =
  inMemoryLayer([
    {
      id: Option.some("always"),
      startAt: DateTime.toDateUtc(DateTime.makeUnsafe(0)),
      stopAt: Option.none(),
    },
  ]);

// ============================================================================
// Define DSL
// ============================================================================

/**
 * The builder handed to {@link define} (`at` / `window` / `fromStarts` / `all`). Exported so the
 * public re-export (`Daemon.scheduleDefine`) can name it; the dts bundler inlines it into the
 * `hyperlink-ts/Daemon` declarations.
 */
export interface ScheduleDefineApi {
  readonly at: typeof at;
  readonly window: typeof window;
  readonly fromStarts: typeof fromStarts;
  readonly all: (
    ...entries: ReadonlyArray<DaemonScheduleEntry>
  ) => ReadonlyArray<DaemonScheduleEntry>;
}

/**
 * Declarative schedule Layer from a combinator DSL.
 *
 * @example
 * ```ts
 * DaemonSchedule.define(({ at, window }) => [
 *   at("job-1", new Date("2025-06-01T00:00:00Z")),
 *   window("game", gameStart, gameEnd),
 * ])
 * ```
 */
const define = (
  build: (api: ScheduleDefineApi) => ReadonlyArray<DaemonScheduleEntry>,
): Layer.Layer<DaemonScheduleTag> =>
  inMemoryLayer(build({ at, window, fromStarts, all: (...entries) => entries }));

// ============================================================================
// Public API
// ============================================================================

/**
 * DaemonSchedule — schedule storage, CRUD, and sync.
 *
 * @public
 */
export const DaemonSchedule: typeof DaemonScheduleTag & {
  readonly inMemory: typeof inMemoryLayer;
  readonly empty: Layer.Layer<DaemonScheduleTag>;
  readonly alwaysArmed: Layer.Layer<DaemonScheduleTag>;
  readonly at: typeof at;
  readonly window: typeof window;
  readonly fromStarts: typeof fromStarts;
  readonly define: typeof define;
} = Object.assign(DaemonScheduleTag, {
  inMemory: inMemoryLayer,
  empty,
  alwaysArmed,
  at,
  window,
  fromStarts,
  define,
});
