import { describe, expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { RunResource, runResourceLayer } from "../src/RunResource";
import { layer as hubLayer } from "../src/TelemetryHub";
import { processStorageWithRunResourceArchiveLayer } from "../src/ProcessStorage";
import { RunResourceStore } from "../src/store/RunResource";

const runResourceObservationLayer = processStorageWithRunResourceArchiveLayer;

const runResourceHubLayer = hubLayer;

const trackedWork = (active: Ref.Ref<number>, peak: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const n = yield* Ref.updateAndGet(active, (x) => x + 1);
    const p = yield* Ref.get(peak);
    if (n > p) yield* Ref.set(peak, n);
    yield* Effect.yieldNow;
    yield* Ref.update(active, (x) => x - 1);
  });

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
    }).pipe(Effect.provide(runResourceHubLayer), Effect.scoped),
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
    }).pipe(Effect.provide(runResourceHubLayer), Effect.scoped),
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
    }).pipe(Effect.provide(runResourceHubLayer), Effect.scoped),
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
    }).pipe(Effect.provide(runResourceHubLayer), Effect.scoped),
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
    }).pipe(Effect.provide(runResourceHubLayer), Effect.scoped),
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
    }).pipe(Effect.provide(runResourceHubLayer), Effect.scoped),
  );

  it.live("runs without archive sink and does not require storage", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/UnobservedGate",
        effect: (n: number) => Effect.succeed(n + 1),
        concurrency: 1,
      });

      const result = yield* gate(9);
      expect(result).toBe(10);
    }).pipe(Effect.provide(runResourceHubLayer), Effect.scoped),
  );

  it.live("persists observed runtime facts through ArchiveSink", () =>
    Effect.gen(function* () {
      const gate = yield* RunResource.make({
        name: "@test/ObservedStoreGate",
        effect: (n: number) => Effect.succeed(n + 1),
        concurrency: 1,
      });

      const result = yield* gate(1);
      const runs = yield* RunResourceStore;
      const stored = yield* runs.facts({
        resourceId: "@test/ObservedStoreGate",
      });
      const stateHistory = yield* runs.stateHistory({
        resourceId: "@test/ObservedStoreGate",
      });

      expect(result).toBe(2);
      // facts() returns DESC by occurredAt; relative order of started vs
      // completed depends on whether their ms-timestamps tie at runtime
      // (Effect.succeed is fast enough that ties happen). Assert presence,
      // not order — and confirm the per-run pairing via runs().
      expect(stored.map((fact) => fact.type).sort()).toEqual([
        "RunResource.Run.Completed",
        "RunResource.Run.Started",
      ]);
      expect(stateHistory.map((change) => change.reason)).toEqual(
        expect.arrayContaining([
          "RunResource.State.Waiting",
          "RunResource.State.Started",
          "RunResource.State.Completed",
        ]),
      );
    }).pipe(Effect.provide(runResourceObservationLayer), Effect.scoped),
  );

  it.live("round-trips observed facts through RunResourceStore queries", () =>
    Effect.gen(function* () {
      const resourceId = "@test/RuntimeQueryGate";
      const gate = yield* RunResource.make({
        name: resourceId,
        effect: (n: number) => Effect.succeed(n + 1),
        concurrency: 1,
      });

      const result = yield* gate(41);
      const runs = yield* RunResourceStore;
      const facts = yield* runs.facts({
        resourceId,
        types: ["RunResource.Run.Started", "RunResource.Run.Completed"],
      });
      const history = yield* runs.stateHistory({ resourceId });
      const paired = yield* runs.runs({ resourceId });

      expect(result).toBe(42);
      // See note on the previous test: assert presence, not order, for
      // ms-tied fact pairs.
      expect(facts.map((fact) => fact.type).sort()).toEqual([
        "RunResource.Run.Completed",
        "RunResource.Run.Started",
      ]);
      expect(history.map((change) => change.reason)).toEqual(
        expect.arrayContaining([
          "RunResource.State.Waiting",
          "RunResource.State.Started",
          "RunResource.State.Completed",
        ]),
      );
      expect(paired).toHaveLength(1);
      expect(paired[0]?.outcome).toBe("completed");
      expect(paired[0]?.resourceId).toBe(resourceId);
    }).pipe(Effect.provide(runResourceObservationLayer), Effect.scoped),
  );
});

describe("RunResource service (yield* RunResource, O4)", () => {
  it.effect("runResourceLayer provides the full factory api with static parity", () =>
    Effect.gen(function* () {
      const api = yield* RunResource;

      // Full factory surface is present on the yielded service…
      expect(typeof api.make).toBe("function");
      expect(typeof api.layer).toBe("function");
      expect(typeof api.Service).toBe("function");
      expect(typeof api.Tag).toBe("function");
      expect(typeof api.makeRunner).toBe("function");

      // …and is the very same object the class statics were attached from.
      expect(api.make).toBe(RunResource.make);
      expect(api.layer).toBe(RunResource.layer);
      expect(api.Service).toBe(RunResource.Service);
      expect(api.Tag).toBe(RunResource.Tag);
      expect(api.makeRunner).toBe(RunResource.makeRunner);
    }).pipe(Effect.provide(runResourceLayer)),
  );

  it.live("api.make builds a working gate", () =>
    Effect.gen(function* () {
      const api = yield* RunResource;
      const gate = yield* api.make({
        name: "@test/o4-make",
        effect: (n: number) => Effect.succeed(n + 1),
        concurrency: 1,
      });
      expect(yield* gate(41)).toBe(42);
    }).pipe(
      Effect.provide(runResourceLayer),
      Effect.provide(runResourceHubLayer),
      Effect.scoped,
    ),
  );

  it.live("api.Service builds a yieldable user gate via its baked layer", () =>
    Effect.gen(function* () {
      const api = yield* RunResource;
      const Gate = api.Service<{ readonly _tag: "O4Svc" }, number, number, never>()(
        "@test/o4-service",
        { effect: (n) => Effect.succeed(n * 2), concurrency: 1 },
      );
      const result = yield* Effect.gen(function* () {
        const gate = yield* Gate;
        return yield* gate(21);
      }).pipe(
        Effect.provide(Gate.layer),
        Effect.provide(runResourceHubLayer),
        Effect.scoped,
      );
      expect(result).toBe(42);
    }).pipe(Effect.provide(runResourceLayer)),
  );

  it.live("api.Tag + api.layer wire an identity gate", () =>
    Effect.gen(function* () {
      const api = yield* RunResource;
      const Gate = api.Tag<{ readonly _tag: "O4Tag" }, number, number, never>()(
        "@test/o4-tag",
      );
      const gateLayer = api.layer(Gate, {
        effect: (n) => Effect.succeed(n + 1),
        concurrency: 1,
      });
      const result = yield* Effect.gen(function* () {
        const gate = yield* Gate;
        return yield* gate(41);
      }).pipe(
        Effect.provide(gateLayer),
        Effect.provide(runResourceHubLayer),
        Effect.scoped,
      );
      expect(result).toBe(42);
    }).pipe(Effect.provide(runResourceLayer)),
  );

  it.live("api.makeRunner gates an arbitrary effect", () =>
    Effect.gen(function* () {
      const api = yield* RunResource;
      const Runner = api.makeRunner({ name: "@test/o4-runner", concurrency: 1 });
      const result = yield* Effect.gen(function* () {
        const run = yield* Runner;
        return yield* run(Effect.succeed(7));
      }).pipe(Effect.provide(Runner.layer), Effect.scoped);
      expect(result).toBe(7);
    }).pipe(Effect.provide(runResourceLayer)),
  );
});
