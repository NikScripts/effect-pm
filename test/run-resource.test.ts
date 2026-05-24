import { it, describe, expect } from "@effect/vitest";
import { Effect, Layer, Option, Ref } from "effect";
import { RunResource } from "../src/RunResource";
import { ProcessStore } from "../src/ProcessStore";
import {
  ProcessStoreRuntime,
  type ProcessStoreRuntimeApi,
} from "../src/ProcessStoreRuntime";
import {
  RuntimeObserver,
  type RuntimeFact,
  type RuntimeObserverListener,
  type RuntimeStateBase,
  type RuntimeStateChange,
} from "../src/RuntimeState";
import type {
  RunResourceFactType,
  RunResourceState,
  RunResourceStateChangeReason,
} from "../src/RunResource";
import { ProcessStoreReadonlyRecordError } from "../src/ProcessStoreEvent";

const runtimeObservationLayer = Layer.provideMerge(
  RuntimeObserver.layer,
  ProcessStore.layer,
);

const trackedWork = (active: Ref.Ref<number>, peak: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const n = yield* Ref.updateAndGet(active, (x) => x + 1);
    const p = yield* Ref.get(peak);
    if (n > p) yield* Ref.set(peak, n);
    yield* Effect.yieldNow;
    yield* Ref.update(active, (x) => x - 1);
  });

const isRunResourceState = (state: RuntimeStateBase): state is RunResourceState =>
  state.ref.kind === "run-resource" &&
  "completed" in state &&
  typeof state.completed === "number" &&
  "failed" in state &&
  typeof state.failed === "number" &&
  "inFlight" in state &&
  typeof state.inFlight === "number";

describe("RunResource.makeRunner", () => {
  it.live("concurrency 1 enforces serial execution", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const work = trackedWork(active, peak);
      const gate = yield* RunResource.make({
        name: "@test/serial-runner",
        effect: (_: void) => work,
        concurrency: 1,
      });
      yield* Effect.all(Array.from({ length: 30 }, () => gate(undefined)), {
        concurrency: "unbounded",
      });
      const p = yield* Ref.get(peak);
      expect(p).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("respects concurrency limit", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const work = trackedWork(active, peak);
      const gate = yield* RunResource.make({
        name: "@test/concurrency-4-runner",
        effect: (_: void) => work,
        concurrency: 4,
      });
      yield* Effect.all(Array.from({ length: 40 }, () => gate(undefined)), {
        concurrency: "unbounded",
      });
      const p = yield* Ref.get(peak);
      expect(p).toBeLessThanOrEqual(4);
      expect(p).toBeGreaterThan(1);
    }).pipe(Effect.scoped),
  );
});

describe("RunResource.Service (parameterized gate)", () => {
  it.live("gates a function effect with concurrency", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/Multiply",
        effect: (n: number) => Effect.succeed(n * 2),
        concurrency: 2,
      });
      const results = yield* Effect.all(
        [gate(5), gate(10), gate(15)],
        { concurrency: "unbounded" },
      );
      expect(results).toEqual([10, 20, 30]);
    }).pipe(Effect.scoped),
  );

  it.live("limits concurrency on parameterized gate", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const gate = yield* RunResource.make({
        name: "@test/SlowGate",
        effect: (s: string) =>
          Effect.gen(function* () {
            const n = yield* Ref.updateAndGet(active, (x) => x + 1);
            const p = yield* Ref.get(peak);
            if (n > p) yield* Ref.set(peak, n);
            yield* Effect.yieldNow;
            yield* Ref.update(active, (x) => x - 1);
            return s.toUpperCase();
          }),
        concurrency: 2,
      });
      yield* Effect.all(
        Array.from({ length: 20 }, (_, i) => gate(`item-${String(i)}`)),
        { concurrency: "unbounded" },
      );
      const p = yield* Ref.get(peak);
      expect(p).toBeLessThanOrEqual(2);
    }).pipe(Effect.scoped),
  );
});

describe("RunResource.Tag + layer", () => {
  it.live("Tag produces valid service key", () =>
    Effect.gen(function* () {
      const tag = RunResource.Tag<
        { readonly _tag: "TestGate" },
        number,
        number,
        never
      >()("@test/TestGate");
      expect(tag.key).toBe("@test/TestGate");
    }),
  );

  it.live("make produces a working gate directly", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/DirectGate",
        effect: (n: number) => Effect.succeed(n + 100),
        concurrency: 1,
      });
      const result = yield* gate(5);
      expect(result).toBe(105);
    }).pipe(Effect.scoped),
  );
});

describe("RunResource.make (raw scoped)", () => {
  it.live("produces a working gate without tags", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/raw",
        effect: (n: number) => Effect.succeed(n * 3),
        concurrency: 2,
      });
      const result = yield* gate(7);
      expect(result).toBe(21);
    }).pipe(Effect.scoped),
  );

  it.live("runs without RuntimeObserver and does not require storage", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/UnobservedGate",
        effect: (n: number) => Effect.succeed(n + 1),
        concurrency: 1,
      });

      const result = yield* gate(9);
      expect(result).toBe(10);
    }).pipe(Effect.scoped),
  );

  it.live("publishes runtime facts when RuntimeObserver is provided", () =>
    Effect.gen(function* () {
      const facts = yield* Ref.make<ReadonlyArray<RuntimeFact>>([]);
      const observer = {
        publishStateChange: () => Effect.void,
        publishFact: (fact: RuntimeFact) =>
          Ref.update(facts, (items) => [...items, fact]),
      };

      yield* Effect.gen(function* () {
        const gate = yield* RunResource.make({
          name: "@test/ObservedGate",
          effect: (n: number) =>
            n > 0 ? Effect.succeed(n) : Effect.fail("negative"),
          concurrency: 1,
        });

        const success = yield* gate(1);
        const failure = yield* gate(0).pipe(Effect.flip);
        const observedFacts = yield* Ref.get(facts);

        expect(success).toBe(1);
        expect(failure).toBe("negative");
        expect(observedFacts.map((fact) => fact.type)).toEqual([
          "run-resource.run.started",
          "run-resource.run.completed",
          "run-resource.run.started",
          "run-resource.run.failed",
        ] satisfies ReadonlyArray<RunResourceFactType>);
        expect(observedFacts.every((fact) => fact.ref.kind === "run-resource")).toBe(true);
        expect(observedFacts.every((fact) => fact.ref.id === "@test/ObservedGate")).toBe(true);
      }).pipe(
        Effect.provideService(RuntimeObserver, observer),
        Effect.scoped,
      );
    }),
  );

  it.live("publishes runtime state changes when RuntimeObserver is provided", () =>
    Effect.gen(function* () {
      const changes = yield* Ref.make<ReadonlyArray<RuntimeStateChange>>([]);
      const observer = {
        publishStateChange: (change: RuntimeStateChange) =>
          Ref.update(changes, (items) => [...items, change]),
        publishFact: (_fact: RuntimeFact) => Effect.void,
      };

      yield* Effect.gen(function* () {
        const gate = yield* RunResource.make({
          name: "@test/ObservedStateGate",
          effect: (n: number) =>
            n > 0 ? Effect.succeed(n) : Effect.fail("negative"),
          concurrency: 1,
        });

        const success = yield* gate(1);
        const failure = yield* gate(0).pipe(Effect.flip);
        const observedChanges = yield* Ref.get(changes);
        const last = observedChanges[observedChanges.length - 1];

        expect(success).toBe(1);
        expect(failure).toBe("negative");
        expect(observedChanges.map((change) => change.reason)).toEqual([
          "run-resource.run.waiting",
          "run-resource.run.started",
          "run-resource.run.completed",
          "run-resource.run.waiting",
          "run-resource.run.started",
          "run-resource.run.failed",
        ] satisfies ReadonlyArray<RunResourceStateChangeReason>);
        expect(last).not.toBeUndefined();
        if (last !== undefined && isRunResourceState(last.current)) {
          expect(last.current.completed).toBe(1);
          expect(last.current.failed).toBe(1);
          expect(last.current.inFlight).toBe(0);
          expect(last.current.waiting).toBe(0);
        } else {
          throw new Error("Expected final RunResource state change");
        }
      }).pipe(
        Effect.provideService(RuntimeObserver, observer),
        Effect.scoped,
      );
    }),
  );

  it.live("notifies multiple scoped listeners and isolates listener failures", () =>
    Effect.gen(function* () {
      const factCount = yield* Ref.make(0);
      const stateReasons = yield* Ref.make<ReadonlyArray<string>>([]);
      const trailingStateCount = yield* Ref.make(0);
      const listeners: ReadonlyArray<RuntimeObserverListener> = [
        {
          onFact: () => Ref.update(factCount, (count) => count + 1),
          onStateChange: (change) =>
            Ref.update(stateReasons, (items) => [...items, change.reason]),
        },
        {
          onFact: () => Effect.fail("fact-listener-failed"),
          onStateChange: () => Effect.fail("state-listener-failed"),
        },
        {
          onStateChange: () =>
            Ref.update(trailingStateCount, (count) => count + 1),
        },
      ];

      yield* Effect.gen(function* () {
        const gate = yield* RunResource.make({
          name: "@test/ObservedListenersGate",
          effect: (n: number) => Effect.succeed(n),
          concurrency: 1,
        });

        const result = yield* gate(1);
        const facts = yield* Ref.get(factCount);
        const reasons = yield* Ref.get(stateReasons);
        const trailing = yield* Ref.get(trailingStateCount);

        expect(result).toBe(1);
        expect(facts).toBe(2);
        expect(reasons).toEqual([
          "run-resource.run.waiting",
          "run-resource.run.started",
          "run-resource.run.completed",
        ]);
        expect(trailing).toBe(3);
      }).pipe(
        Effect.provide(RuntimeObserver.layerListeners(listeners)),
        Effect.scoped,
      );
    }),
  );

  it.live("persists observed runtime facts through ProcessStoreRuntime", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/ObservedStoreGate",
        effect: (n: number) => Effect.succeed(n + 1),
        concurrency: 1,
      });

      const result = yield* gate(1);
      const runtime = yield* ProcessStoreRuntime;
      const stored = yield* runtime.facts({
        ref: { kind: "run-resource", id: "@test/ObservedStoreGate" },
      });
      const stateHistory = yield* runtime.stateHistory({
        ref: { kind: "run-resource", id: "@test/ObservedStoreGate" },
      });

      expect(result).toBe(2);
      expect(stored.map((fact) => fact.type)).toEqual([
        "run-resource.run.started",
        "run-resource.run.completed",
      ]);
      expect(stateHistory.map((change) => change.reason)).toEqual(
        expect.arrayContaining([
          "run-resource.run.waiting",
          "run-resource.run.started",
          "run-resource.run.completed",
        ]),
      );
    }).pipe(Effect.provide(runtimeObservationLayer), Effect.scoped),
  );

  it.live("isolates ProcessStoreRuntime write failures from gated effect success", () => {
    const failingRuntime: ProcessStoreRuntimeApi = {
      recordFact: () =>
        Effect.fail(new ProcessStoreReadonlyRecordError({ id: "fact" })),
      recordStateChange: () =>
        Effect.fail(new ProcessStoreReadonlyRecordError({ id: "state" })),
      recordFactBatch: () =>
        Effect.fail(new ProcessStoreReadonlyRecordError({ id: "batch-facts" })),
      recordStateChangeBatch: () =>
        Effect.fail(new ProcessStoreReadonlyRecordError({ id: "batch-states" })),
      facts: () => Effect.succeed([]),
      runResourceFacts: () => Effect.succeed([]),
      stateHistory: () => Effect.succeed([]),
      latestState: () => Effect.succeed(Option.none()),
    };

    return Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/FailingStoreGate",
        effect: (n: number) => Effect.succeed(n + 1),
        concurrency: 1,
      });

      const result = yield* gate(1);
      expect(result).toBe(2);
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          RuntimeObserver.layer,
          Layer.succeed(ProcessStoreRuntime, failingRuntime),
        ),
      ),
      Effect.scoped,
    );
  });

  it.live("round-trips observed facts through ProcessStoreRuntime queries", () =>
    Effect.gen(function* () {
      const resourceId = "@test/RuntimeQueryGate";
      const gate = yield* RunResource.make({
        name: resourceId,
        effect: (n: number) => Effect.succeed(n + 1),
        concurrency: 1,
      });

      const result = yield* gate(41);
      const runtime = yield* ProcessStoreRuntime;
      const facts = yield* runtime.facts({
        ref: { kind: "run-resource", id: resourceId },
        types: ["run-resource.run.started", "run-resource.run.completed"],
      });
      const history = yield* runtime.stateHistory({
        ref: { kind: "run-resource", id: resourceId },
      });

      expect(result).toBe(42);
      expect(facts.map((fact) => fact.type)).toEqual([
        "run-resource.run.started",
        "run-resource.run.completed",
      ]);
      expect(history.map((change) => change.reason)).toEqual(
        expect.arrayContaining([
          "run-resource.run.waiting",
          "run-resource.run.started",
          "run-resource.run.completed",
        ]),
      );
    }).pipe(Effect.provide(runtimeObservationLayer), Effect.scoped),
  );
});
