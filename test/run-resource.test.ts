import { it, describe, expect } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref, Schema } from "effect";
import * as RunResource from "../src/RunResource";
import * as Store from "../src/Store";
import { StoreScopeBridgeTag, type StoreScopeBridge } from "../src/internal/store/bridge";
import { ProcessStoreReadonlyRecordError } from "../src/ProcessStoreEvent";
import { builtInRunResourceStoreContract } from "../src/internal/store/runResourceStoreSpec";

const trackedWork = (active: Ref.Ref<number>, peak: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const n = yield* Ref.updateAndGet(active, (x) => x + 1);
    const p = yield* Ref.get(peak);
    if (n > p) yield* Ref.set(peak, n);
    yield* Effect.yieldNow;
    yield* Ref.update(active, (x) => x - 1);
  });

describe("RunResource.make", () => {
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
      yield* Effect.all(Array.from({ length: 30 }, () => gate.run()), {
        concurrency: "unbounded",
      });
      const p = yield* Ref.get(peak);
      expect(p).toBe(1);
    }).pipe(Effect.provide(Store.layerDefaultMemory), Effect.scoped),
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
      yield* Effect.all(Array.from({ length: 40 }, () => gate.run()), {
        concurrency: "unbounded",
      });
      const p = yield* Ref.get(peak);
      expect(p).toBeLessThanOrEqual(4);
      expect(p).toBeGreaterThan(1);
    }).pipe(Effect.provide(Store.layerDefaultMemory), Effect.scoped),
  );

  it.live("gates a function effect with concurrency", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/Multiply",
        effect: (n: number) => Effect.succeed(n * 2),
        concurrency: 2,
      });
      const results = yield* Effect.all(
        [gate.run(5), gate.run(10), gate.run(15)],
        { concurrency: "unbounded" },
      );
      expect(results).toEqual([10, 20, 30]);
    }).pipe(Effect.provide(Store.layerDefaultMemory), Effect.scoped),
  );

  it.live("does not expose observation subscribables", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/UnobservedGate",
        effect: (n: number) => Effect.succeed(n + 1),
        concurrency: 1,
      });
      expect("status" in gate).toBe(false);
      expect("waiting" in gate).toBe(false);
    }).pipe(Effect.provide(Store.layerDefaultMemory), Effect.scoped),
  );
});

describe("RunResource.Service", () => {
  it.live("limits concurrency on parameterized gate", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const SlowGate = RunResource.Tag<{ readonly _tag: "SlowGate" }>()(
        "@test/SlowGate",
        Schema.String,
        Schema.String,
      );
      const gateLayer = RunResource.layer(SlowGate, {
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

      yield* Effect.gen(function* () {
        const gate = yield* SlowGate;
        yield* Effect.all(
          Array.from({ length: 20 }, (_, i) => gate.run(`item-${String(i)}`)),
          { concurrency: "unbounded",
          },
        );
        const p = yield* Ref.get(peak);
        expect(p).toBeLessThanOrEqual(2);
      }).pipe(Effect.provide(gateLayer));
    }),
  );

  class SlowGate extends RunResource.Service<SlowGate>()("@test/SlowGateService", {
    payload: Schema.String,
    success: Schema.String,
    effect: (s: string) => Effect.succeed(s.toUpperCase()),
    concurrency: 2,
  }) {}

  const slowLayer = SlowGate.layer;

  it.live("static run accessor requires the service in R", () =>
    Effect.gen(function* () {
      const result = yield* SlowGate.run("hello");
      expect(result).toBe("HELLO");
    }).pipe(Effect.provide(slowLayer)),
  );

  it.live("completed counter updates after run", () =>
    Effect.gen(function* () {
      const gate = yield* SlowGate;
      yield* gate.run("a");
      const completedAfter = yield* gate.completed.get;
      expect(completedAfter).toBe(1);

      const status = yield* gate.status.get;
      expect(status.inFlight).toBe(0);
      expect(status.waiting).toBe(0);
      expect(status.completed).toBe(1);
    }).pipe(Effect.provide(slowLayer)),
  );
});

describe("RunResource.Tag + layer", () => {
  const TestGate = RunResource.Tag<{ readonly _tag: "TestGate" }>()(
    "@test/TestGate",
    Schema.Number,
    Schema.Number,
  );

  const testLayer = RunResource.layer(TestGate, {
    effect: (n: number) => Effect.succeed(n + 100),
    concurrency: 1,
  });

  it("Tag produces valid service key", () => {
    expect(TestGate.key).toBe("@test/TestGate");
  });

  it("Tag accepts schema config object", () => {
    const ConfigGate = RunResource.Tag<{ readonly _tag: "ConfigGate" }>()("@test/ConfigGate", {
      payload: Schema.Number,
      success: Schema.Number,
      description: "config-object tag",
    });
    expect(ConfigGate.key).toBe("@test/ConfigGate");
  });

  it.live("layer provides observable handle", () =>
    Effect.gen(function* () {
      const gate = yield* TestGate;
      const result = yield* gate.run(5);
      expect(result).toBe(105);
      const waiting = yield* gate.waiting.get;
      expect(waiting).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("static run accessor on Tag", () =>
    Effect.gen(function* () {
      const result = yield* TestGate.run(7);
      expect(result).toBe(107);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("configure patch folds at layer build", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const live = Layer.mergeAll(
        RunResource.layer(TestGate, {
          effect: (n: number) =>
            Effect.gen(function* () {
              const nActive = yield* Ref.updateAndGet(active, (x) => x + 1);
              const p = yield* Ref.get(peak);
              if (nActive > p) yield* Ref.set(peak, nActive);
              yield* Effect.yieldNow;
              yield* Ref.update(active, (x) => x - 1);
              return n;
            }),
          concurrency: 1,
        }),
        RunResource.configure(TestGate, { concurrency: 3 }),
      );

      yield* Effect.gen(function* () {
        const gate = yield* TestGate;
        yield* Effect.all(
          Array.from({ length: 12 }, () => gate.run(1)),
          { concurrency: "unbounded" },
        );
        const p = yield* Ref.get(peak);
        expect(p).toBeLessThanOrEqual(3);
      }).pipe(Effect.provide(live));
    }),
  );
});

describe("RunResource.make — default store bridge", () => {
  const scopeKey = "@test/default-store-gate";

  it.effect("auto-writes facts to layerDefaultMemory without AppStore registration", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: scopeKey,
        scopeKey,
        effect: (n: number) => Effect.succeed(n),
        concurrency: 1,
      });
      yield* gate.run(1);

      const bridge = yield* StoreScopeBridgeTag;
      const store = yield* bridge.at(scopeKey, builtInRunResourceStoreContract({ key: scopeKey }));
      const facts = yield* store.facts();
      expect(facts.map((row) => row.type).sort()).toEqual([
        "run-resource.run.completed",
        "run-resource.run.started",
      ]);
    }).pipe(Effect.provide(Store.layerDefaultMemory), Effect.scoped),
  );

  it.effect("persists failed runs and state transitions on the default bridge", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: scopeKey,
        scopeKey: `${scopeKey}/failed`,
        effect: (n: number) =>
          n >= 0 ? Effect.succeed(n) : Effect.fail("negative"),
        concurrency: 1,
      });
      yield* gate.run(-1).pipe(Effect.flip);

      const bridge = yield* StoreScopeBridgeTag;
      const failedScope = `${scopeKey}/failed`;
      const store = yield* bridge.at(
        failedScope,
        builtInRunResourceStoreContract({ key: failedScope }),
      );
      const facts = yield* store.facts();
      const history = yield* store.stateHistory();
      expect(facts.some((row) => row.type === "run-resource.run.failed")).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(Store.layerDefaultMemory), Effect.scoped),
  );
});

describe("RunResource.layer — baked default store bridge", () => {
  const BakedGate = RunResource.Tag<{ readonly _tag: "BakedGate" }>()(
    "@test/BakedGate",
    Schema.Number,
    Schema.Number,
  );

  const bakedLayer = RunResource.layer(BakedGate, {
    effect: (n: number) => Effect.succeed(n),
    concurrency: 1,
  });

  it.effect("persists facts without an extra Store.layerDefaultMemory at app root", () =>
    Effect.gen(function* () {
      const gate = yield* BakedGate;
      yield* gate.run(1);

      const bridge = yield* StoreScopeBridgeTag;
      const store = yield* bridge.at(
        BakedGate.key,
        builtInRunResourceStoreContract({ key: BakedGate.key }),
      );
      const facts = yield* store.facts();
      expect(facts.map((row) => row.type).sort()).toEqual([
        "run-resource.run.completed",
        "run-resource.run.started",
      ]);
    }).pipe(Effect.provide(bakedLayer), Effect.scoped),
  );
});

describe("RunResource.layer — RunResource.store records", () => {
  const StoreGate = RunResource.Tag<{ readonly _tag: "StoreGate" }>()(
    "@test/StoreGate",
    Schema.Number,
    Schema.Number,
  );

  const storeGateRegistration = RunResource.store(StoreGate);

  class TestRunStore extends Store.Service<TestRunStore>("@test/RunStore")(
    storeGateRegistration,
  ) {}

  const live = RunResource.layer(StoreGate, {
    effect: (n: number) => Effect.succeed(n * 2),
    concurrency: 1,
  }).pipe(Layer.provideMerge(TestRunStore.layerMemory));

  it.effect("writes facts when the gate runs", () =>
    Effect.gen(function* () {
      const gate = yield* StoreGate;
      yield* gate.run(21);
      const store = yield* TestRunStore.at(StoreGate);
      const facts = yield* store.facts();
      expect(facts.map((row) => row.type).sort()).toEqual([
        "run-resource.run.completed",
        "run-resource.run.started",
      ]);
      expect(facts.find((row) => row.type === "run-resource.run.completed")).toMatchObject({
        durationMs: expect.any(Number),
      });
    }).pipe(Effect.provide(live), Effect.scoped),
  );
});

describe("RunResource.makeRunner", () => {
  const Runner = RunResource.makeRunner({
    name: "@test/Runner",
    concurrency: 2,
  });

  it.live("wraps arbitrary effects with concurrency", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const work = trackedWork(active, peak);
      const runner = yield* Runner;
      yield* Effect.all(
        Array.from({ length: 20 }, () => runner(work)),
        { concurrency: "unbounded" },
      );
      const p = yield* Ref.get(peak);
      expect(p).toBeLessThanOrEqual(2);
    }).pipe(Effect.provide(Runner.layer)),
  );
});

describe("RunResource — unit gates and interrupts", () => {
  class UnitGate extends RunResource.Service<UnitGate>()("@test/UnitGate", {
    payload: Schema.Void,
    success: Schema.Number,
    effect: () => Effect.succeed(42),
    concurrency: 1,
  }) {}

  const unitLayer = UnitGate.layer;

  it.live("Service.run() accepts no input for Schema.Void payload", () =>
    Effect.gen(function* () {
      const gate = yield* UnitGate;
      const fromHandle = yield* gate.run();
      const fromStatic = yield* UnitGate.run();
      expect(fromHandle).toBe(42);
      expect(fromStatic).toBe(42);
    }).pipe(Effect.provide(unitLayer)),
  );

  const holdLayer = (hold: Deferred.Deferred<void, never>, key: string) => {
    const HoldGate = RunResource.Tag<{ readonly _tag: "HoldGate" }>()(
      key,
      Schema.Void,
      Schema.Void,
    );
    return {
      tag: HoldGate,
      layer: RunResource.layer(HoldGate, {
        effect: () => Deferred.await(hold),
        concurrency: 1,
      }),
    };
  };

  // Waiting-acquire interrupt accounting is covered by `test/run-resource-pure.test.ts`
  // (`interruptWaitingAcquire`). Live sem.take + Fiber.interrupt is scheduler-sensitive in Effect v4.

  it.live("in-flight interrupt increments interrupted without failing the gate service", () =>
    Effect.gen(function* () {
      const hold = yield* Deferred.make<void, never>();
      const { tag: HoldGate, layer } = holdLayer(hold, "@test/HoldGate/in-flight-interrupt");

      yield* Effect.gen(function* () {
        const gate = yield* HoldGate;
        const inFlight = yield* Effect.forkChild(gate.run());
        yield* Effect.yieldNow;
        expect(yield* gate.inFlight.get).toBe(1);
        yield* Fiber.interrupt(inFlight);
        yield* Fiber.await(inFlight);
        expect(yield* gate.interrupted.get).toBe(1);
        expect(yield* gate.inFlight.get).toBe(0);
        yield* Deferred.succeed(hold, undefined);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped),
  );
});

describe("RunResource.layer — store failure isolation", () => {
  const scopeKey = "@test/store-failure-gate";

  const FailingBridgeGate = RunResource.Tag<{ readonly _tag: "FailingBridgeGate" }>()(
    scopeKey,
    Schema.Number,
    Schema.Number,
  );

  const failingBridgeLayer = Layer.succeed(StoreScopeBridgeTag, {
    at: () =>
      Effect.succeed({
        record: () =>
          Effect.fail(new ProcessStoreReadonlyRecordError({ id: "blocked-fact" })),
        recordStateChange: () =>
          Effect.fail(new ProcessStoreReadonlyRecordError({ id: "blocked-state" })),
        facts: () => Effect.succeed([]),
        stateHistory: () => Effect.succeed([]),
      }),
    changes: () => Effect.die(new Error("unused")),
  } as unknown as StoreScopeBridge);

  const live = RunResource.layer(FailingBridgeGate, {
    effect: (n: number) => Effect.succeed(n + 1),
    concurrency: 1,
  }).pipe(Layer.provideMerge(failingBridgeLayer));

  it.effect("gate.run succeeds when store writes fail", () =>
    Effect.gen(function* () {
      const gate = yield* FailingBridgeGate;
      const result = yield* gate.run(10);
      expect(result).toBe(11);
      expect(yield* gate.completed.get).toBe(1);
    }).pipe(Effect.provide(live), Effect.scoped),
  );
});
