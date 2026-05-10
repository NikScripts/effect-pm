/**
 * **ProcessSchedule** — centralized schedule storage + controls.
 *
 * @remarks
 * A process schedule entry defines an absolute start time and optional stop time.
 * Process runtimes consume this service to:
 * - spawn run fibers at `startAt`
 * - stop repeating loops after `stopAt` (if present)
 *
 * @module ProcessSchedule
 */

import { Context, Deferred, Effect, Layer, Option, Ref } from "effect";

/**
 * One scheduled run window for a process.
 *
 * @public
 */
export interface ProcessScheduleEntry {
  readonly id: Option.Option<string>;
  readonly startAt: Date;
  readonly stopAt: Option.Option<Date>;
}

const sortEntries = (
  entries: ReadonlyArray<ProcessScheduleEntry>,
): ReadonlyArray<ProcessScheduleEntry> =>
  [...entries].sort((a, b) => {
    const byStart = a.startAt.getTime() - b.startAt.getTime();
    if (byStart !== 0) {
      return byStart;
    }
    const aStop = Option.match(a.stopAt, {
      onNone: () => Number.POSITIVE_INFINITY,
      onSome: (d) => d.getTime(),
    });
    const bStop = Option.match(b.stopAt, {
      onNone: () => Number.POSITIVE_INFINITY,
      onSome: (d) => d.getTime(),
    });
    return aStop - bStop;
  });

const normalizeEntries = (
  entries: ReadonlyArray<ProcessScheduleEntry>,
): ReadonlyArray<ProcessScheduleEntry> =>
  sortEntries(entries);

/**
 * Schedule service used by process runtimes and control APIs.
 *
 * @public
 */
export interface ProcessScheduleService {
  readonly entries: Effect.Effect<ReadonlyArray<ProcessScheduleEntry>, never, never>;
  readonly set: (
    entries: ReadonlyArray<ProcessScheduleEntry>,
  ) => Effect.Effect<void, never, never>;
  readonly add: (
    entry: ProcessScheduleEntry,
  ) => Effect.Effect<void, never, never>;
  readonly clear: Effect.Effect<void, never, never>;
  readonly changed: Effect.Effect<void, never, never>;
}

const ProcessScheduleTag = Context.Service<ProcessScheduleService>(
  "@effect-pm/ProcessSchedule",
);

const buildInMemoryService = (
  initial: ReadonlyArray<ProcessScheduleEntry>,
): Effect.Effect<ProcessScheduleService, never, never> =>
  Effect.gen(function* () {
    const entriesRef = yield* Ref.make<ReadonlyArray<ProcessScheduleEntry>>(
      normalizeEntries(initial),
    );
    const changeSignal = yield* Ref.make<Deferred.Deferred<void, never>>(
      yield* Deferred.make<void>(),
    );

    const notify = Effect.gen(function* () {
      const current = yield* Ref.get(changeSignal);
      yield* Deferred.succeed(current, undefined);
      const next = yield* Deferred.make<void>();
      yield* Ref.set(changeSignal, next);
    });

    const set = (
      entries: ReadonlyArray<ProcessScheduleEntry>,
    ): Effect.Effect<void> =>
      Ref.set(entriesRef, normalizeEntries(entries)).pipe(
        Effect.andThen(() => notify),
      );

    const add = (entry: ProcessScheduleEntry): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(entriesRef);
        yield* set([...current, entry]);
      });

    const clear = set([]);

    return {
      entries: Ref.get(entriesRef),
      set,
      add,
      clear,
      changed: Ref.get(changeSignal).pipe(
        Effect.flatMap((d) => Deferred.await(d)),
      ),
    };
  });

const inMemoryLayer = (
  initial: ReadonlyArray<ProcessScheduleEntry> = [],
): Layer.Layer<ProcessScheduleService, never, never> =>
  Layer.effect(
    ProcessScheduleTag,
    buildInMemoryService(initial),
  );

const toId = (id: string | undefined): Option.Option<string> =>
  id === undefined ? Option.none() : Option.some(id);

function at(startAt: Date): ProcessScheduleEntry;
function at(id: string, startAt: Date): ProcessScheduleEntry;
function at(
  idOrStartAt: string | Date,
  maybeStartAt?: Date,
): ProcessScheduleEntry {
  if (idOrStartAt instanceof Date) {
    return {
      id: Option.none(),
      startAt: idOrStartAt,
      stopAt: Option.none(),
    };
  }
  if (maybeStartAt === undefined) {
    throw new Error("ProcessSchedule.at(id, startAt) requires a startAt Date");
  }
  return {
    id: toId(idOrStartAt),
    startAt: maybeStartAt,
    stopAt: Option.none(),
  };
}

function window(startAt: Date, stopAt: Date): ProcessScheduleEntry;
function window(id: string, startAt: Date, stopAt: Date): ProcessScheduleEntry;
function window(
  idOrStartAt: string | Date,
  startAtOrStopAt: Date,
  maybeStopAt?: Date,
): ProcessScheduleEntry {
  if (idOrStartAt instanceof Date) {
    return {
      id: Option.none(),
      startAt: idOrStartAt,
      stopAt: Option.some(startAtOrStopAt),
    };
  }
  if (maybeStopAt === undefined) {
    throw new Error("ProcessSchedule.window(id, startAt, stopAt) requires stopAt Date");
  }
  return {
    id: toId(idOrStartAt),
    startAt: startAtOrStopAt,
    stopAt: Option.some(maybeStopAt),
  };
}

const fromStarts = (
  starts: ReadonlyArray<Date>,
): ReadonlyArray<ProcessScheduleEntry> =>
  starts.map((startAt) => at(startAt));

interface DefineApi {
  readonly at: typeof at;
  readonly window: typeof window;
  readonly fromStarts: typeof fromStarts;
  readonly all: (
    ...entries: ReadonlyArray<ProcessScheduleEntry>
  ) => ReadonlyArray<ProcessScheduleEntry>;
}

const define = (
  build: (api: DefineApi) => ReadonlyArray<ProcessScheduleEntry>,
): Layer.Layer<ProcessScheduleService, never, never> =>
  inMemoryLayer(
    build({
      at,
      window,
      fromStarts,
      all: (...entries) => entries,
    }),
  );

/**
 * Context tag + in-memory constructors for process schedule storage.
 *
 * @public
 */
export const ProcessSchedule: typeof ProcessScheduleTag & {
  readonly inMemory: typeof inMemoryLayer;
  readonly at: typeof at;
  readonly window: typeof window;
  readonly fromStarts: typeof fromStarts;
  readonly define: typeof define;
} = Object.assign(ProcessScheduleTag, {
  inMemory: inMemoryLayer,
  at,
  window,
  fromStarts,
  define,
});
