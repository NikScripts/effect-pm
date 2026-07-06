import { it, describe, expect } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";
import * as RunResource from "../src/RunResource";

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
      yield* Effect.all(Array.from({ length: 40 }, () => gate.run()), {
        concurrency: "unbounded",
      });
      const p = yield* Ref.get(peak);
      expect(p).toBeLessThanOrEqual(4);
      expect(p).toBeGreaterThan(1);
    }).pipe(Effect.scoped),
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
    }).pipe(Effect.scoped),
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
    }).pipe(Effect.scoped),
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
    inputSchema: Schema.String,
    successSchema: Schema.String,
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
      inputSchema: Schema.Number,
      successSchema: Schema.Number,
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
