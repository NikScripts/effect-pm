/**
 * @module examples/resource-tui/live-queues
 *
 * A small fleet of **real toolkit `QueueResource`s** + their live atoms — the data
 * layer behind the dashboard. Each queue is a tag with a local layer (worker +
 * producer daemon); `Atom.runtime(AppLayer)` is the seam (swap in `Resource.client`
 * per tag for remote later). One bundle per queue exposes the live `status` /
 * `metrics` / `logs` / `trend` atoms and the control fns.
 */

import { Data, Duration, Effect, Layer, Logger, Schema, Stream } from "effect";
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

// producer daemon: items arrive on their own, mixed priority
const producerFor = <Id extends AllQueues>(
  tag: QueueTag<Id>,
): Layer.Layer<never, never, Id> =>
  Layer.effectDiscard(
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
    }),
  );

const AppLayer = Layer.mergeAll(
  producerFor(Mail).pipe(Layer.provideMerge(QueueResource.layer(Mail, cfg))),
  producerFor(Jobs).pipe(Layer.provideMerge(QueueResource.layer(Jobs, cfg))),
  producerFor(Billing).pipe(Layer.provideMerge(QueueResource.layer(Billing, cfg))),
  producerFor(Notify).pipe(Layer.provideMerge(QueueResource.layer(Notify, cfg))),
  producerFor(Worker1).pipe(Layer.provideMerge(QueueResource.layer(Worker1, cfg))),
  producerFor(Worker2).pipe(Layer.provideMerge(QueueResource.layer(Worker2, cfg))),
  producerFor(Worker3).pipe(Layer.provideMerge(QueueResource.layer(Worker3, cfg))),
  producerFor(RegionUS).pipe(Layer.provideMerge(QueueResource.layer(RegionUS, cfg))),
  producerFor(RegionEU).pipe(Layer.provideMerge(QueueResource.layer(RegionEU, cfg))),
  producerFor(Daily).pipe(Layer.provideMerge(QueueResource.layer(Daily, cfg))),
  producerFor(Weekly).pipe(Layer.provideMerge(QueueResource.layer(Weekly, cfg))),
).pipe(
  // silence the default console logger so captured worker logs don't bleed onto the
  // Ink alt-screen — captureLogs still routes them to each queue's `logs` stream.
  Layer.provide(Logger.layer([], { mergeWithExisting: false })),
);

export const runtime = Atom.runtime(AppLayer);

export interface LogLine {
  readonly id: number;
  readonly t: number;
  readonly level: string;
  readonly message: string;
}

/** The live atoms + controls for one queue. */
const bundle = <Id extends AllQueues>(tag: QueueTag<Id>) => ({
  status: runtime.atom(Stream.unwrap(Effect.map(tag, (q) => q.status))),
  metrics: runtime.atom(Stream.unwrap(Effect.map(tag, (q) => q.metrics))),
  logs: runtime.atom(
    Stream.unwrap(Effect.map(tag, (q) => q.logs)).pipe(
      Stream.scan([] as ReadonlyArray<LogLine>, (acc, l) =>
        [
          ...acc,
          { id: (logId += 1), t: Date.now(), level: l.level, message: l.message },
        ].slice(-300),
      ),
    ),
  ),
  trend: runtime.atom(
    Stream.unwrap(Effect.map(tag, (q) => q.status)).pipe(
      Stream.scan([] as ReadonlyArray<number>, (acc, s) =>
        [...acc, s.sizes.high + s.sizes.normal + s.sizes.low].slice(-40),
      ),
    ),
  ),
  pause: runtime.fn((_: void) => Effect.flatMap(tag, (q) => q.pause)),
  resume: runtime.fn((_: void) => Effect.flatMap(tag, (q) => q.resume)),
  clear: runtime.fn((_: void) => Effect.flatMap(tag, (q) => q.clear)),
  shutdown: runtime.fn((_: void) => Effect.flatMap(tag, (q) => q.shutdown)),
});

export type QueueBundle = ReturnType<typeof bundle>;

/** id → its live atoms + controls. */
export const REGISTRY: Record<string, QueueBundle> = {
  [Mail.id]: bundle(Mail),
  [Jobs.id]: bundle(Jobs),
  [Billing.id]: bundle(Billing),
  [Notify.id]: bundle(Notify),
  [Worker1.id]: bundle(Worker1),
  [Worker2.id]: bundle(Worker2),
  [Worker3.id]: bundle(Worker3),
  [RegionUS.id]: bundle(RegionUS),
  [RegionEU.id]: bundle(RegionEU),
  [Daily.id]: bundle(Daily),
  [Weekly.id]: bundle(Weekly),
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
