/**
 * **ProcessSchedule contract (control surface)** — the `ProcessScheduleService` CRUD expressed
 * as a {@link Resource} {@link Spec}, so a process's schedule store can be driven **remotely**
 * over RPC (the same `yield* Tag` code runs local or remote; only the provided layer changes).
 *
 * @remarks
 * This is the **first slice** of porting `ProcessSchedule` onto the toolkit — the full read /
 * mutate / sync surface of `ProcessScheduleService` (`entries`, `get`, `has`, `set`, `add`,
 * `upsert`, `remove`, `removeMany`, `clear`, `reconcile`) plus a `changes` stream (the wire form
 * of the service's `changed` signal — it emits the current entries on every mutation). Reuses
 * {@link processScheduleEntry} (the wire form of a schedule entry) from the Process contract.
 *
 * Unlike the schedule verbs on {@link processControlSpec} (which expose only `set`/`add`/`clear`
 * for the schedule *behind a process*), this is the schedule **as its own resource** — the full
 * CRUD, including the diff-based `reconcile` a DB-sync consumer needs.
 *
 * The impl (wrapping a live `ProcessScheduleService`) and the `Tag` / `layer` / `server` /
 * `serveHttp` wiring land in the next slice.
 *
 * @module ProcessScheduleContract
 */
import { Schema } from "effect";
import { Resource } from "./Resource";
import { processScheduleEntry } from "./ProcessContract";

/**
 * The result of a `reconcile` — which entry ids were added / updated / removed / unchanged
 * relative to the provided set. The wire form of the engine's `ReconcileResult`.
 *
 * @public
 */
export const reconcileResult = Schema.Struct({
  added: Schema.Array(Schema.String),
  updated: Schema.Array(Schema.String),
  removed: Schema.Array(Schema.String),
  unchanged: Schema.Array(Schema.String),
});

/**
 * The process-schedule **control** contract: the full CRUD + sync surface of a
 * `ProcessScheduleService`, drivable remotely. Mirrors the service members one-for-one; `get`
 * returns `null` (not the engine's `Option`) when the id is absent, and `changes` is the wire
 * form of the `changed` signal (emits the entries on each mutation).
 *
 * @public
 */
export const processScheduleSpec = {
  // ─── Read ───
  entries: Resource.query(Schema.Array(processScheduleEntry)).annotate({
    description: "All current schedule entries, sorted by startAt.",
  }),
  get: Resource.query(Schema.NullOr(processScheduleEntry), {
    payload: { id: Schema.String },
  }).annotate({
    description: "Look up an entry by id; null if not found.",
  }),
  has: Resource.query(Schema.Boolean, {
    payload: { id: Schema.String },
  }).annotate({
    description: "Whether an entry with the given id exists.",
  }),

  // ─── Mutate ───
  set: Resource.mutate(Schema.Void, {
    payload: Schema.Array(processScheduleEntry),
  }).annotate({
    description: "Replace all entries.",
  }),
  add: Resource.mutate(Schema.Void, {
    payload: processScheduleEntry,
  }).annotate({
    description: "Append one entry.",
  }),
  upsert: Resource.mutate(Schema.Void, {
    payload: processScheduleEntry,
  }).annotate({
    description: "Insert or update an entry by id.",
  }),
  remove: Resource.mutate(Schema.Boolean, {
    payload: { id: Schema.String },
  }).annotate({
    description: "Remove an entry by id; returns whether it was found.",
    destructive: true,
  }),
  removeMany: Resource.mutate(Schema.Number, {
    payload: { ids: Schema.Array(Schema.String) },
  }).annotate({
    description: "Remove multiple entries by id; returns the count removed.",
    destructive: true,
  }),
  clear: Resource.mutate(Schema.Void).annotate({
    description: "Remove all entries.",
    destructive: true,
  }),

  // ─── Sync ───
  reconcile: Resource.mutate(reconcileResult, {
    payload: Schema.Array(processScheduleEntry),
  }).annotate({
    description:
      "Diff-based sync from an external source (e.g. a DB): apply added/updated/removed " +
      "atomically and report what changed.",
  }),

  // ─── Observe ───
  changes: Resource.stream(Schema.Array(processScheduleEntry)).annotate({
    description: "Emits the current entries on every mutation (the wire form of `changed`).",
  }),
};
// Note: no `satisfies Spec` — that would contextually widen each method's error channel to
// `unknown`. The spec is validated (without widening) at the `Resource.Tag` call site (next slice).
