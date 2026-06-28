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
import { QueueResource } from "../../src";

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
/** A windowed metrics sample for charts. */
export interface MetricPoint {
  readonly t: number;
  readonly throughput: number;
  readonly latency: number;
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
  readonly historyRef: SubscriptionRef.SubscriptionRef<ReadonlyArray<MetricPoint>>;
  readonly logsRef: SubscriptionRef.SubscriptionRef<ReadonlyArray<LogLine>>;
  readonly trendRef: SubscriptionRef.SubscriptionRef<ReadonlyArray<number>>;
}
// ── persistence / backfill ──────────────────────────────────────────────────
// In the browser, the log + metrics history survives a refresh (localStorage). Node
// (the Ink dashboard) has no localStorage, so this is a no-op there.
const PERSIST_KEY = "queue-dashboard-history-v1";
const canPersist = typeof localStorage !== "undefined";
interface Saved {
  readonly logs: ReadonlyArray<LogLine>;
  readonly history: ReadonlyArray<MetricPoint>;
  readonly trend: ReadonlyArray<number>;
}
const loadStore = (): Record<string, Saved> => {
  if (!canPersist) {
    return {};
  }
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    return raw === null ? {} : (JSON.parse(raw) as Record<string, Saved>);
  } catch {
    return {};
  }
};
const STORE = loadStore();
// continue log ids past anything restored so React keys stay unique
logId = Object.values(STORE).reduce(
  (mx, s) => s.logs.reduce((n, l) => Math.max(n, l.id), mx),
  logId,
);

const mkRefs = (id: string): Refs => {
  const saved = STORE[id];
  return {
    statusRef: Effect.runSync(SubscriptionRef.make<Snapshot | undefined>(undefined)),
    metricsRef: Effect.runSync(SubscriptionRef.make<Metrics | undefined>(undefined)),
    historyRef: Effect.runSync(SubscriptionRef.make<ReadonlyArray<MetricPoint>>(saved?.history ?? [])),
    logsRef: Effect.runSync(SubscriptionRef.make<ReadonlyArray<LogLine>>(saved?.logs ?? [])),
    trendRef: Effect.runSync(SubscriptionRef.make<ReadonlyArray<number>>(saved?.trend ?? [])),
  };
};

const REFS: Record<string, Refs> = {
  [Mail.key]: mkRefs(Mail.key),
  [Jobs.key]: mkRefs(Jobs.key),
  [Billing.key]: mkRefs(Billing.key),
  [Notify.key]: mkRefs(Notify.key),
  [Worker1.key]: mkRefs(Worker1.key),
  [Worker2.key]: mkRefs(Worker2.key),
  [Worker3.key]: mkRefs(Worker3.key),
  [RegionUS.key]: mkRefs(RegionUS.key),
  [RegionEU.key]: mkRefs(RegionEU.key),
  [Daily.key]: mkRefs(Daily.key),
  [Weekly.key]: mkRefs(Weekly.key),
};

/** One row of the fleet table — live status + headline metrics per queue. */
export interface FleetRow {
  readonly id: string;
  readonly phase: string;
  readonly paused: boolean;
  readonly pending: number;
  readonly completed: number;
  readonly inFlight: number;
  readonly throughput: number;
  readonly latency: number;
}
const fleetRef = Effect.runSync(SubscriptionRef.make<Record<string, FleetRow>>({}));
/** The whole fleet in one atom — one subscription feeds a sortable table. */
export const fleetAtom = Atom.make(SubscriptionRef.changes(fleetRef));
const patchFleet = (id: string, patch: Partial<FleetRow>): Effect.Effect<void> =>
  SubscriptionRef.update(fleetRef, (f) => {
    const prev = f[id] ?? {
      id,
      phase: "running",
      paused: false,
      pending: 0,
      completed: 0,
      inFlight: 0,
      throughput: 0,
      latency: 0,
    };
    return { ...f, [id]: { ...prev, ...patch } };
  });

// per-queue daemons: producer + accumulators draining into the refs + fleet table
const daemonsFor = <Id extends AllQueues>(
  tag: QueueTag<Id>,
  id: string,
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
    yield* Effect.forkDetach(
      Stream.runForEach(q.metrics, (m) =>
        Effect.gen(function* () {
          yield* SubscriptionRef.set(refs.metricsRef, m);
          yield* SubscriptionRef.update(refs.historyRef, (acc) =>
            [...acc, { t: Date.now(), throughput: m.throughputPerSec, latency: m.avgTotalMillis ?? 0 }].slice(-60),
          );
          yield* patchFleet(id, { throughput: m.throughputPerSec, latency: m.avgTotalMillis ?? 0 });
        }),
      ),
    );
    yield* Effect.forkDetach(
      Stream.runForEach(q.status, (s) =>
        Effect.gen(function* () {
          const pending = s.sizes.high + s.sizes.normal + s.sizes.low;
          yield* SubscriptionRef.set(refs.statusRef, s);
          yield* SubscriptionRef.update(refs.trendRef, (acc) => [...acc, pending].slice(-40));
          yield* patchFleet(id, {
            phase: s.phase,
            paused: s.paused,
            pending,
            completed: s.completed,
            inFlight: s.inFlight,
          });
        }),
      ),
    );
  });

// boot the whole fleet once, at module load
managed.runFork(
  Effect.gen(function* () {
    yield* daemonsFor(Mail, Mail.key, REFS[Mail.key]!);
    yield* daemonsFor(Jobs, Jobs.key, REFS[Jobs.key]!);
    yield* daemonsFor(Billing, Billing.key, REFS[Billing.key]!);
    yield* daemonsFor(Notify, Notify.key, REFS[Notify.key]!);
    yield* daemonsFor(Worker1, Worker1.key, REFS[Worker1.key]!);
    yield* daemonsFor(Worker2, Worker2.key, REFS[Worker2.key]!);
    yield* daemonsFor(Worker3, Worker3.key, REFS[Worker3.key]!);
    yield* daemonsFor(RegionUS, RegionUS.key, REFS[RegionUS.key]!);
    yield* daemonsFor(RegionEU, RegionEU.key, REFS[RegionEU.key]!);
    yield* daemonsFor(Daily, Daily.key, REFS[Daily.key]!);
    yield* daemonsFor(Weekly, Weekly.key, REFS[Weekly.key]!);
    return yield* Effect.never;
  }),
);

// snapshot the log + metrics history to localStorage so a refresh backfills the
// charts/logs instead of starting empty (browser only).
if (canPersist) {
  setInterval(() => {
    const snapshot: Record<string, Saved> = {};
    for (const id of Object.keys(REFS)) {
      const refs = REFS[id]!;
      snapshot[id] = {
        logs: Effect.runSync(SubscriptionRef.get(refs.logsRef)),
        history: Effect.runSync(SubscriptionRef.get(refs.historyRef)),
        trend: Effect.runSync(SubscriptionRef.get(refs.trendRef)),
      };
    }
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(snapshot));
    } catch {
      /* over quota — drop this snapshot */
    }
  }, 5000);
}

/** The live atoms + control fns for one queue. Atoms read the accumulator refs
 *  (current value on mount, so opening a queue shows the history already gathered). */
const bundle = <Id extends AllQueues>(tag: QueueTag<Id>, refs: Refs) => ({
  status: Atom.make(SubscriptionRef.changes(refs.statusRef)),
  metrics: Atom.make(SubscriptionRef.changes(refs.metricsRef)),
  history: Atom.make(SubscriptionRef.changes(refs.historyRef)),
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
  [Mail.key]: bundle(Mail, REFS[Mail.key]!),
  [Jobs.key]: bundle(Jobs, REFS[Jobs.key]!),
  [Billing.key]: bundle(Billing, REFS[Billing.key]!),
  [Notify.key]: bundle(Notify, REFS[Notify.key]!),
  [Worker1.key]: bundle(Worker1, REFS[Worker1.key]!),
  [Worker2.key]: bundle(Worker2, REFS[Worker2.key]!),
  [Worker3.key]: bundle(Worker3, REFS[Worker3.key]!),
  [RegionUS.key]: bundle(RegionUS, REFS[RegionUS.key]!),
  [RegionEU.key]: bundle(RegionEU, REFS[RegionEU.key]!),
  [Daily.key]: bundle(Daily, REFS[Daily.key]!),
  [Weekly.key]: bundle(Weekly, REFS[Weekly.key]!),
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
    { t: "q", name: Mail.key },
    { t: "q", name: Jobs.key },
    { t: "q", name: Billing.key },
    {
      t: "g",
      name: "@acme/queues/Workers",
      members: [
        { t: "q", name: Worker1.key },
        { t: "q", name: Worker2.key },
        { t: "q", name: Worker3.key },
        {
          t: "g",
          name: "@acme/queues/Regional",
          members: [
            { t: "q", name: RegionUS.key },
            { t: "q", name: RegionEU.key },
          ],
        },
      ],
    },
    {
      t: "g",
      name: "@acme/queues/Reports",
      members: [
        { t: "q", name: Daily.key },
        { t: "q", name: Weekly.key },
      ],
    },
    { t: "q", name: Notify.key },
  ],
};
