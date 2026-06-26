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
import { Context, Effect, Layer, Option, Schema, Stream } from "effect";
import { Resource, hostSym } from "./Resource";
import type {
  HandlerContextOf,
  HostKey,
  LocalCapability,
  ResourceTag,
  ServiceOf,
} from "./Resource";
import { ProcessSchedule } from "./ProcessSchedule";
import {
  fromWireScheduleEntry,
  processScheduleEntry,
  toWireScheduleEntry,
} from "./ScheduledProcess";

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
// `unknown`. The spec is validated (without widening) at the `Resource.Tag` call site.

/** The (shared, fixed) spec every process-schedule instance is built from. */
type ProcessScheduleSpec = typeof processScheduleSpec;

/**
 * Define a process schedule as a toolkit resource:
 *
 * ```ts
 * class Cron extends ProcessScheduleResource.Tag<Cron>()("@app/Cron") {}
 * const s = yield* Cron;
 * yield* s.reconcile(entriesFromDb);
 * ```
 *
 * A fixed shared spec (every schedule has the same CRUD), so this binds a plain
 * {@link Resource.Tag}. `Self` is given explicitly. Pass `options.host` to bind to a
 * {@link Resource.Host} (ship only the tag; see {@link Resource.client} / {@link Resource.connect}).
 *
 * @public
 */
export const processScheduleTag = <Self>() => {
  function build<HSelf>(
    id: string,
    options: { readonly description?: string; readonly host: HostKey<HSelf> },
  ): ResourceTag<Self, ProcessScheduleSpec> & { readonly [hostSym]: HostKey<HSelf> };
  function build(
    id: string,
    options?: { readonly description?: string },
  ): ResourceTag<Self, ProcessScheduleSpec>;
  function build(
    id: string,
    options?: { readonly description?: string; readonly host?: HostKey<unknown> },
  ): ResourceTag<Self, ProcessScheduleSpec> {
    const host = options?.host;
    return host === undefined
      ? Resource.Tag<Self>(id, options)(processScheduleSpec)
      : Resource.Tag<Self>(id, options)(processScheduleSpec, host);
  }
  return build;
};

/**
 * The config for {@link ProcessScheduleResource.layer} — optional initial entries. The store is
 * an in-memory {@link ProcessSchedule}; a consumer that wants a different backing can compose
 * their own service (a future slice may accept a `ProcessSchedule` layer directly).
 *
 * @public
 */
export interface ProcessScheduleLayerConfig {
  readonly initial?: ReadonlyArray<typeof processScheduleEntry.Type>;
}

/**
 * Build a live {@link ProcessSchedule} service behind `tag` and map it onto the toolkit service
 * impl — shared by the local {@link layer} and the remote {@link server} / {@link serveHttp}.
 * The service has no requirements, so the impl needs nothing beyond the build scope.
 */
const buildProcessScheduleImpl = <Self>(config?: ProcessScheduleLayerConfig) =>
  Effect.gen(function* () {
    const initial = (config?.initial ?? []).map(fromWireScheduleEntry);
    const scheduleCtx = yield* Layer.build(ProcessSchedule.inMemory(initial));
    const service = Context.get(scheduleCtx, ProcessSchedule);

    const wireEntries = Effect.map(service.entries, (entries) =>
      entries.map(toWireScheduleEntry),
    );

    const impl: ServiceOf<ProcessScheduleSpec, Self> = {
      entries: wireEntries,
      get: ({ id }) =>
        Effect.map(
          service.get(id),
          Option.match({ onNone: () => null, onSome: toWireScheduleEntry }),
        ),
      has: ({ id }) => service.has(id),
      set: (entries) => service.set(entries.map(fromWireScheduleEntry)),
      add: (entry) => service.add(fromWireScheduleEntry(entry)),
      upsert: (entry) => service.upsert(fromWireScheduleEntry(entry)),
      remove: ({ id }) => service.remove(id),
      removeMany: ({ ids }) => service.removeMany(ids),
      clear: service.clear,
      // ReconcileResult is already { added/updated/removed/unchanged: string[] } — matches the
      // reconcileResult schema directly, no mapping.
      reconcile: (entries) => service.reconcile(entries.map(fromWireScheduleEntry)),
      // Emit the entries now, then again on every mutation (`changed` gates each re-read).
      changes: Stream.concat(
        Stream.fromEffect(wireEntries),
        Stream.forever(
          Stream.fromEffect(service.changed.pipe(Effect.andThen(wireEntries))),
        ),
      ),
    };
    return impl;
  });

export const layer = <Self>(
  tag: ResourceTag<Self, ProcessScheduleSpec>,
  config?: ProcessScheduleLayerConfig,
): Layer.Layer<Self | LocalCapability<Self>> =>
  Layer.unwrap(
    Effect.map(buildProcessScheduleImpl<Self>(config), (impl) =>
      Resource.layer(tag, impl),
    ),
  );

/**
 * Expose a toolkit process schedule **over RPC** (transport-agnostic). Compose with an
 * `RpcServer` + a `Protocol` layer to serve; or use {@link serveHttp} for the http batteries.
 *
 * @public
 */
export const server = <Self>(
  tag: ResourceTag<Self, ProcessScheduleSpec>,
  config?: ProcessScheduleLayerConfig,
): Layer.Layer<HandlerContextOf<ProcessScheduleSpec>> =>
  Layer.unwrap(
    Effect.map(buildProcessScheduleImpl<Self>(config), (impl) =>
      Resource.server(tag, impl),
    ),
  );

/**
 * Serve a toolkit process schedule **over http** in one call (ndjson by default). Provide an
 * `HttpServer` and a {@link Resource.client} + transport drives it as if local.
 *
 * @public
 */
export const serveHttp = <Self>(
  tag: ResourceTag<Self, ProcessScheduleSpec>,
  config?: ProcessScheduleLayerConfig,
  options?: Parameters<typeof Resource.serveHttp>[2],
) =>
  Layer.unwrap(
    Effect.map(buildProcessScheduleImpl<Self>(config), (impl) =>
      Resource.serveHttp(tag, impl, options),
    ),
  );

/**
 * Process-schedule resource toolkit — a schedule store (CRUD + reconcile) on the
 * {@link Resource} toolkit. `layer` runs it locally; `server` / `serveHttp` host it remotely;
 * a remote {@link Resource.client} drives it with the same `yield* Tag` surface.
 *
 * @public
 */
// The unified `ProcessScheduleResource` namespace is assembled in
// `internal/processScheduleResourceNamespace.ts` and re-exported by the barrel as `export * as`
// (so member access tree-shakes: the light `Tag`/spec never pulls the engine).
//
// DX: `import * as ProcessScheduleResource from "@nikscripts/effect-pm/ProcessScheduleContract"`
// gives a tree-shakeable namespace — `.Tag` (alias of `processScheduleTag`) pulls no engine code.
export { processScheduleTag as Tag };
