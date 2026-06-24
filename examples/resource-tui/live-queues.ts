/**
 * @module examples/resource-tui/live-queues
 *
 * A small fleet of **real toolkit `QueueResource`s** + their live atoms — the data
 * layer behind the dashboard. Each queue is a tag with a local layer (worker +
 * producer daemon); `Atom.runtime(AppLayer)` is the seam (swap in `Resource.client`
 * per tag for remote later). One bundle per queue exposes the live `status` /
 * `metrics` / `logs` / `trend` atoms and the control fns.
 */

import {
  Data,
  Duration,
  Effect,
  Layer,
  Logger,
  ManagedRuntime,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import { Atom } from "effect/unstable/reactivity";
import { QueueResource } from "../../src/QueueContract";

const Job = Schema.Struct({ id: Schema.String });

// the fleet — one tag per queue (unique id + Self)
class Mail extends QueueResource.Tag<Mail>()("@acme/queues/Mail", Job) {}
class Jobs extends QueueResource.Tag<Jobs>()("@acme/queues/Jobs", Job) {}
class Billing extends QueueResource.Tag<Billing>()("@acme/queues/Billing", Job) {}
class Notify extends QueueResource.Tag<Notify>()("@acme/queues/Notify", Job) {}
class Worker1 extends QueueResource.Tag<Worker1>()("@acme/queues/Worker1", Job) {}
class Worker2 extends QueueResource.Tag<Worker2>()("@acme/queues/Worker2", Job) {}
class Worker3 extends QueueResource.Tag<Worker3>()("@acme/queues/Worker3", Job) {}
class RegionUS extends QueueResource.Tag<RegionUS>()("@acme/queues/RegionUS", Job) {}
class RegionEU extends QueueResource.Tag<RegionEU>()("@acme/queues/RegionEU", Job) {}
class Daily extends QueueResource.Tag<Daily>()("@acme/queues/Daily", Job) {}
class Weekly extends QueueResource.Tag<Weekly>()("@acme/queues/Weekly", Job) {}

type AllQueues =
  | Mail
  | Jobs
  | Billing
  | Notify
  | Worker1
  | Worker2
  | Worker3
  | RegionUS
  | RegionEU
  | Daily
  | Weekly;
type SuccessOf<T> = [T] extends [Effect.Effect<infer A, infer _E, infer _R>] ? A : never;
type QueueSvc = SuccessOf<typeof Mail>;
type QueueTag<Id extends AllQueues> = Effect.Effect<QueueSvc, never, Id>;

class WorkerError extends Data.TaggedError("WorkerError")<{
  readonly id: string;
}> {}

let rngState = 0x2545f491;
const rng = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};
let logId = 0;
const hexKey = (): string =>
  Math.floor(rng() * 0xffff)
    .toString(16)
    .padStart(4, "0");

// shared worker: logs each step, varies duration, fails occasionally
const cfg = {
  effect: (job: { readonly id: string }) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`processing ${job.id}`);
      yield* Effect.sleep(Duration.millis(250 + Math.floor(rng() * 900)));
      if (rng() < 0.1) {
        yield* Effect.logError(`failed ${job.id}`);
        return yield* new WorkerError({ id: job.id });
      }
      yield* Effect.logInfo(`completed ${job.id}`);
      return job;
    }),
  concurrency: 3,
  attempts: 2,
  captureLogs: true,
} as const;

export interface LogLine {
  readonly id: number;
  readonly t: number;
  readonly level: string;
  readonly message: string;
}
type Snapshot = QueueSvc extends { readonly status: Stream.Stream<infer S, infer _E, infer _R> }
  ? S
  : never;
type Metrics = QueueSvc extends { readonly metrics: Stream.Stream<infer M, infer _E, infer _R> }
  ? M
  : never;

// The queue engines only (workers). Producers + accumulators are run imperatively in
// the boot below — NOT as layers — because `Atom.runtime` builds layers lazily and
// can skip side-effecting daemon layers entirely. Running them on a ManagedRuntime
// from module load makes accumulation deterministic and independent of the UI.
const AppLayer = Layer.mergeAll(
  QueueResource.layer(Mail, cfg),
  QueueResource.layer(Jobs, cfg),
  QueueResource.layer(Billing, cfg),
  QueueResource.layer(Notify, cfg),
  QueueResource.layer(Worker1, cfg),
  QueueResource.layer(Worker2, cfg),
  QueueResource.layer(Worker3, cfg),
  QueueResource.layer(RegionUS, cfg),
  QueueResource.layer(RegionEU, cfg),
  QueueResource.layer(Daily, cfg),
  QueueResource.layer(Weekly, cfg),
).pipe(
  // silence the default console logger so captured worker logs don't bleed onto the
  // Ink alt-screen — captureLogs still routes them to each queue's `logs` stream.
  Layer.provide(Logger.layer([], { mergeWithExisting: false })),
);

const managed = ManagedRuntime.make(AppLayer);

// per-queue accumulator state — filled by the boot daemons from module load, so the
// latest status/metrics + log/trend history are always current when an atom mounts.
interface Refs {
  readonly statusRef: SubscriptionRef.SubscriptionRef<Snapshot | undefined>;
  readonly metricsRef: SubscriptionRef.SubscriptionRef<Metrics | undefined>;
  readonly logsRef: SubscriptionRef.SubscriptionRef<ReadonlyArray<LogLine>>;
  readonly trendRef: SubscriptionRef.SubscriptionRef<ReadonlyArray<number>>;
}
const mkRefs = (): Refs => ({
  statusRef: Effect.runSync(SubscriptionRef.make<Snapshot | undefined>(undefined)),
  metricsRef: Effect.runSync(SubscriptionRef.make<Metrics | undefined>(undefined)),
  logsRef: Effect.runSync(SubscriptionRef.make<ReadonlyArray<LogLine>>([])),
  trendRef: Effect.runSync(SubscriptionRef.make<ReadonlyArray<number>>([])),
});

const REFS: Record<string, Refs> = {
  [Mail.id]: mkRefs(),
  [Jobs.id]: mkRefs(),
  [Billing.id]: mkRefs(),
  [Notify.id]: mkRefs(),
  [Worker1.id]: mkRefs(),
  [Worker2.id]: mkRefs(),
  [Worker3.id]: mkRefs(),
  [RegionUS.id]: mkRefs(),
  [RegionEU.id]: mkRefs(),
  [Daily.id]: mkRefs(),
  [Weekly.id]: mkRefs(),
};

// per-queue daemons: producer + accumulators draining into the refs
const daemonsFor = <Id extends AllQueues>(
  tag: QueueTag<Id>,
  refs: Refs,
): Effect.Effect<void, never, Id> =>
  Effect.gen(function* () {
    const q = yield* tag;
    yield* Effect.forkDetach(
      Effect.forever(
        Effect.gen(function* () {
          const r = rng();
          const item = { id: hexKey() };
          yield* r < 0.2 ? q.prioritize(item) : r < 0.85 ? q.add(item) : q.defer(item);
          yield* Effect.sleep(Duration.millis(300 + Math.floor(rng() * 500)));
        }),
      ),
    );
    yield* Effect.forkDetach(
      Stream.runForEach(q.logs, (l) =>
        SubscriptionRef.update(refs.logsRef, (acc) =>
          [...acc, { id: (logId += 1), t: Date.now(), level: l.level, message: l.message }].slice(-300),
        ),
      ),
    );
    yield* Effect.forkDetach(Stream.runForEach(q.metrics, (m) => SubscriptionRef.set(refs.metricsRef, m)));
    yield* Effect.forkDetach(
      Stream.runForEach(q.status, (s) =>
        Effect.gen(function* () {
          yield* SubscriptionRef.set(refs.statusRef, s);
          yield* SubscriptionRef.update(refs.trendRef, (acc) =>
            [...acc, s.sizes.high + s.sizes.normal + s.sizes.low].slice(-40),
          );
        }),
      ),
    );
  });

// boot the whole fleet once, at module load
managed.runFork(
  Effect.gen(function* () {
    yield* daemonsFor(Mail, REFS[Mail.id]!);
    yield* daemonsFor(Jobs, REFS[Jobs.id]!);
    yield* daemonsFor(Billing, REFS[Billing.id]!);
    yield* daemonsFor(Notify, REFS[Notify.id]!);
    yield* daemonsFor(Worker1, REFS[Worker1.id]!);
    yield* daemonsFor(Worker2, REFS[Worker2.id]!);
    yield* daemonsFor(Worker3, REFS[Worker3.id]!);
    yield* daemonsFor(RegionUS, REFS[RegionUS.id]!);
    yield* daemonsFor(RegionEU, REFS[RegionEU.id]!);
    yield* daemonsFor(Daily, REFS[Daily.id]!);
    yield* daemonsFor(Weekly, REFS[Weekly.id]!);
    return yield* Effect.never;
  }),
);

/** The live atoms + control fns for one queue. Atoms read the accumulator refs
 *  (current value on mount, so opening a queue shows the history already gathered). */
const bundle = <Id extends AllQueues>(tag: QueueTag<Id>, refs: Refs) => ({
  status: Atom.make(SubscriptionRef.changes(refs.statusRef)),
  metrics: Atom.make(SubscriptionRef.changes(refs.metricsRef)),
  logs: Atom.make(SubscriptionRef.changes(refs.logsRef)),
  trend: Atom.make(SubscriptionRef.changes(refs.trendRef)),
  pause: () => void managed.runFork(Effect.flatMap(tag, (q) => q.pause)),
  resume: () => void managed.runFork(Effect.flatMap(tag, (q) => q.resume)),
  clear: () => void managed.runFork(Effect.flatMap(tag, (q) => q.clear)),
  shutdown: () => void managed.runFork(Effect.flatMap(tag, (q) => q.shutdown)),
});

export type QueueBundle = ReturnType<typeof bundle>;

/** id → its live atoms + controls. */
export const REGISTRY: Record<string, QueueBundle> = {
  [Mail.id]: bundle(Mail, REFS[Mail.id]!),
  [Jobs.id]: bundle(Jobs, REFS[Jobs.id]!),
  [Billing.id]: bundle(Billing, REFS[Billing.id]!),
  [Notify.id]: bundle(Notify, REFS[Notify.id]!),
  [Worker1.id]: bundle(Worker1, REFS[Worker1.id]!),
  [Worker2.id]: bundle(Worker2, REFS[Worker2.id]!),
  [Worker3.id]: bundle(Worker3, REFS[Worker3.id]!),
  [RegionUS.id]: bundle(RegionUS, REFS[RegionUS.id]!),
  [RegionEU.id]: bundle(RegionEU, REFS[RegionEU.id]!),
  [Daily.id]: bundle(Daily, REFS[Daily.id]!),
  [Weekly.id]: bundle(Weekly, REFS[Weekly.id]!),
};

export type Node =
  | { readonly t: "q"; readonly name: string }
  | { readonly t: "g"; readonly name: string; readonly members: ReadonlyArray<Node> };
export type Group = Extract<Node, { t: "g" }>;

/** The navigable tree (names are the real tag ids). */
export const TREE: Group = {
  t: "g",
  name: "@acme/queues/Ops",
  members: [
    { t: "q", name: Mail.id },
    { t: "q", name: Jobs.id },
    { t: "q", name: Billing.id },
    {
      t: "g",
      name: "@acme/queues/Workers",
      members: [
        { t: "q", name: Worker1.id },
        { t: "q", name: Worker2.id },
        { t: "q", name: Worker3.id },
        {
          t: "g",
          name: "@acme/queues/Regional",
          members: [
            { t: "q", name: RegionUS.id },
            { t: "q", name: RegionEU.id },
          ],
        },
      ],
    },
    {
      t: "g",
      name: "@acme/queues/Reports",
      members: [
        { t: "q", name: Daily.id },
        { t: "q", name: Weekly.id },
      ],
    },
    { t: "q", name: Notify.id },
  ],
};
