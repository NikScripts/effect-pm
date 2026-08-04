import { describe, expect, it } from "@effect/vitest";
import {
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Option,
  Ref,
  Schema,
  Stream,
} from "effect";
import * as Gate from "../src/Gate";
import * as Hyperlink from "../src/Hyperlink";
import * as Lifecycle from "../src/Lifecycle";

// Focused Lifecycle coverage for Gate (P10): pause hold-all, stop / stopMode,
// live reconfig, readiness, Participating duals, deferStart, lifecycleEvents.

/** Await until a count Subscribable reaches `want` (does not replay current — seed first). */
const awaitCount = (
  sub: { readonly get: Effect.Effect<number>; readonly changes: Stream.Stream<number> },
  want: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if ((yield* sub.get) >= want) return;
    yield* Stream.runDrain(
      Stream.take(
        Stream.filter(sub.changes, (n) => n >= want),
        1,
      ),
    );
  });

const awaitTag = <A extends { readonly _tag: string }>(
  changes: Stream.Stream<A>,
  tag: A["_tag"],
): Effect.Effect<A, never> =>
  Stream.runHead(Stream.filter(changes, (s) => s._tag === tag)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.never,
        onSome: Effect.succeed,
      }),
    ),
    Effect.timeout(Duration.seconds(2)),
    Effect.orDie,
  );

describe("Gate — Lifecycle pause", () => {
  it.live("pause holds new calls until resume", () =>
    Effect.gen(function* () {
      const executed = yield* Ref.make(0);
      class PausableGate extends Gate.define<PausableGate>()(
        "@test/lifecycle/PausableGate",
        {
          payload: Schema.Number,
          success: Schema.Void,
          effect: (_n: number) => Ref.update(executed, (x) => x + 1),
          concurrency: 1,
        },
      ) {}

      yield* Effect.gen(function* () {
        const gate = yield* PausableGate;
        yield* gate.pause;
        expect((yield* gate.lifecycle.get)._tag).toBe("Paused");

        const fiber = yield* Effect.forkChild(gate.run(1));
        yield* awaitCount(gate.waiting, 1);
        expect(yield* Ref.get(executed)).toBe(0);

        yield* gate.resume;
        expect((yield* gate.lifecycle.get)._tag).toBe("Running");
        yield* Fiber.join(fiber);
        expect(yield* Ref.get(executed)).toBe(1);
      }).pipe(Effect.provide(PausableGate.layer), Effect.scoped);
    }),
  );

  it.live("pause holds callers already waiting for a permit", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const executed = yield* Ref.make<ReadonlyArray<number>>([]);
      class HoldWaitingGate extends Gate.define<HoldWaitingGate>()(
        "@test/lifecycle/HoldWaitingGate",
        {
          payload: Schema.Number,
          success: Schema.Void,
          effect: (n: number) =>
            Effect.gen(function* () {
              yield* Ref.update(executed, (xs) => [...xs, n]);
              if (n === 1) {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
              }
            }),
          concurrency: 1,
        },
      ) {}

      yield* Effect.gen(function* () {
        const gate = yield* HoldWaitingGate;

        const inFlight = yield* Effect.forkChild(gate.run(1));
        yield* Deferred.await(started);
        const waiter = yield* Effect.forkChild(gate.run(2));
        yield* awaitCount(gate.waiting, 1);

        yield* gate.pause;
        expect((yield* gate.lifecycle.get)._tag).toBe("Paused");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(inFlight);

        // Still paused — body of run(2) cannot enter (second latch).
        expect(yield* Ref.get(executed)).toEqual([1]);

        yield* gate.resume;
        yield* Fiber.join(waiter);
        expect(yield* Ref.get(executed)).toEqual([1, 2]);
      }).pipe(Effect.provide(HoldWaitingGate.layer), Effect.scoped);
    }),
  );
});

describe("Gate — Lifecycle stop", () => {
  it.live("stop rejects new calls with GateStopped", () =>
    Effect.gen(function* () {
      class StoppableGate extends Gate.define<StoppableGate>()(
        "@test/lifecycle/StoppableGate",
        {
          payload: Schema.Number,
          success: Schema.Number,
          effect: (n: number) => Effect.succeed(n * 2),
          concurrency: 1,
        },
      ) {}

      yield* Effect.gen(function* () {
        const gate = yield* StoppableGate;
        yield* gate.stop;
        expect((yield* gate.lifecycle.get)._tag).toBe("Off");

        const result = yield* gate.run(21).pipe(
          Effect.catchTag("GateStopped", (err) => {
            expect(err).toBeInstanceOf(Gate.GateStopped);
            return Effect.succeed(-1);
          }),
        );
        expect(result).toBe(-1);
      }).pipe(Effect.provide(StoppableGate.layer), Effect.scoped);
    }),
  );

  it.live("failWaiting: stop fails callers waiting for a permit", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      class FailWaitingGate extends Gate.define<FailWaitingGate>()(
        "@test/lifecycle/FailWaitingGate",
        {
          payload: Schema.Number,
          success: Schema.Void,
          effect: (n: number) =>
            n === 1
              ? Effect.gen(function* () {
                  yield* Deferred.succeed(started, undefined);
                  yield* Deferred.await(release);
                })
              : Effect.void,
          concurrency: 1,
          stopMode: "failWaiting",
        },
      ) {}

      yield* Effect.gen(function* () {
        const gate = yield* FailWaitingGate;

        const inFlight = yield* Effect.forkChild(gate.run(1));
        yield* Deferred.await(started);
        expect(yield* gate.inFlight.get).toBe(1);

        const waiter = yield* Effect.forkChild(
          gate.run(2).pipe(
            Effect.catchTag("GateStopped", (err) => Effect.succeed(err)),
          ),
        );
        yield* awaitCount(gate.waiting, 1);

        const stopFiber = yield* Effect.forkChild(gate.stop);
        const waiterErr = yield* Fiber.join(waiter);
        expect(waiterErr).toBeInstanceOf(Gate.GateStopped);

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(inFlight);
        yield* Fiber.join(stopFiber);
        expect((yield* gate.lifecycle.get)._tag).toBe("Off");
      }).pipe(Effect.provide(FailWaitingGate.layer), Effect.scoped);
    }),
  );

  it.live("finishWaiting: stop lets waiting callers complete", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const completed = yield* Ref.make<ReadonlyArray<number>>([]);
      class FinishWaitingGate extends Gate.define<FinishWaitingGate>()(
        "@test/lifecycle/FinishWaitingGate",
        {
          payload: Schema.Number,
          success: Schema.Void,
          effect: (n: number) =>
            Effect.gen(function* () {
              if (n === 1) {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
              }
              yield* Ref.update(completed, (xs) => [...xs, n]);
            }),
          concurrency: 1,
          stopMode: "finishWaiting",
        },
      ) {}

      yield* Effect.gen(function* () {
        const gate = yield* FinishWaitingGate;

        const inFlight = yield* Effect.forkChild(gate.run(1));
        yield* Deferred.await(started);
        const waiter = yield* Effect.forkChild(Effect.exit(gate.run(2)));
        yield* awaitCount(gate.waiting, 1);

        const draining = yield* Effect.forkChild(
          awaitTag(gate.lifecycle.changes, "Draining"),
        );
        const stopFiber = yield* Effect.forkChild(gate.stop);
        yield* Fiber.join(draining);
        yield* Deferred.succeed(release, undefined);

        yield* Fiber.join(inFlight);
        const waiterExit = yield* Fiber.join(waiter);
        expect(Exit.isSuccess(waiterExit)).toBe(true);
        yield* Fiber.join(stopFiber);

        expect((yield* gate.lifecycle.get)._tag).toBe("Off");
        expect((yield* Ref.get(completed)).slice().sort()).toEqual([1, 2]);
      }).pipe(Effect.provide(FinishWaitingGate.layer), Effect.scoped);
    }),
  );
});

describe("Gate — live reconfig", () => {
  it.live("setConcurrency resizes the semaphore and bumps configVersion", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0);
      const peak = yield* Ref.make(0);
      const gate1 = yield* Deferred.make<void>();
      const reachedPeak = yield* Deferred.make<void>();
      class ResizableGate extends Gate.define<ResizableGate>()(
        "@test/lifecycle/ResizableGate",
        {
          payload: Schema.Number,
          success: Schema.Void,
          effect: (_n: number) =>
            Effect.gen(function* () {
              const n = yield* Ref.updateAndGet(active, (x) => x + 1);
              const p = yield* Ref.get(peak);
              if (n > p) yield* Ref.set(peak, n);
              if (n === 3) yield* Deferred.succeed(reachedPeak, undefined);
              yield* Deferred.await(gate1);
              yield* Ref.update(active, (x) => x - 1);
            }),
          concurrency: 1,
        },
      ) {}

      yield* Effect.gen(function* () {
        const gate = yield* ResizableGate;
        const before = yield* gate.status.get;
        expect(before.concurrency).toBe(1);
        expect(before.configVersion).toBe(1);

        yield* gate.setConcurrency(3);
        const after = yield* gate.status.get;
        expect(after.concurrency).toBe(3);
        expect(after.configVersion).toBe(2);

        const f1 = yield* Effect.forkChild(gate.run(1));
        const f2 = yield* Effect.forkChild(gate.run(2));
        const f3 = yield* Effect.forkChild(gate.run(3));
        yield* Deferred.await(reachedPeak);
        expect(yield* Ref.get(peak)).toBe(3);
        yield* Deferred.succeed(gate1, undefined);
        yield* Fiber.join(f1);
        yield* Fiber.join(f2);
        yield* Fiber.join(f3);
      }).pipe(Effect.provide(ResizableGate.layer), Effect.scoped);
    }),
  );

  it.live("setRateLimit updates the limit and bumps configVersion", () =>
    Effect.gen(function* () {
      class RateGate extends Gate.define<RateGate>()(
        "@test/lifecycle/RateGate",
        {
          payload: Schema.Number,
          success: Schema.Number,
          effect: (n: number) => Effect.succeed(n),
          concurrency: 4,
        },
      ) {}

      yield* Effect.gen(function* () {
        const gate = yield* RateGate;
        const before = yield* gate.status.get;
        expect(before.configVersion).toBe(1);

        yield* gate.setRateLimit({
          limit: 5,
          window: Duration.seconds(1),
          onExceeded: "delay",
        });
        const after = yield* gate.status.get;
        expect(after.configVersion).toBe(2);
        expect(yield* gate.metrics.remaining.get).toBe(5);

        yield* gate.setRateLimit(null);
        expect((yield* gate.status.get).configVersion).toBe(3);
      }).pipe(Effect.provide(RateGate.layer), Effect.scoped);
    }),
  );
});

describe("Gate — Lifecycle duals, events, readiness, deferStart", () => {
  class DualGate extends Gate.define<DualGate>()("@test/lifecycle/DualGate", {
    payload: Schema.Number,
    success: Schema.Number,
    effect: (n: number) => Effect.succeed(n),
    concurrency: 2,
  }) {}

  it.live("Lifecycle.pause/resume/stop duals on handle and Tag", () =>
    Effect.gen(function* () {
      const gate = yield* DualGate;
      expect((yield* gate.lifecycle.get)._tag).toBe("Running");

      yield* Lifecycle.pause(DualGate);
      expect((yield* gate.lifecycle.get)._tag).toBe("Paused");

      yield* Lifecycle.resume(gate);
      expect((yield* gate.lifecycle.get)._tag).toBe("Running");

      yield* Lifecycle.stop(DualGate);
      expect((yield* gate.lifecycle.get)._tag).toBe("Off");
    }).pipe(Effect.provide(DualGate.layer), Effect.scoped),
  );

  it.live("lifecycleEvents derive Paused / Stopped from badge changes", () =>
    Effect.gen(function* () {
      const gate = yield* DualGate;
      const sawPaused = yield* Deferred.make<string>();
      yield* Lifecycle.events(gate).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.flatMap((chunk) =>
          Deferred.succeed(sawPaused, [...chunk][0]!._tag),
        ),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* gate.pause;
      expect(yield* Deferred.await(sawPaused)).toBe("Paused");

      const sawStopped = yield* Deferred.make<Lifecycle.Event>();
      yield* Lifecycle.events(gate).pipe(
        Stream.filter((e) => e._tag === "Stopped"),
        Stream.take(1),
        Stream.runCollect,
        Effect.flatMap((chunk) =>
          Deferred.succeed(sawStopped, [...chunk][0]!),
        ),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* gate.stop;
      const event = yield* Deferred.await(sawStopped);
      expect(event._tag).toBe("Stopped");
      if (event._tag === "Stopped") {
        expect(event.to._tag).toBe("Off");
      }
    }).pipe(Effect.provide(DualGate.layer), Effect.scoped),
  );

  it.live("readiness follows the Lifecycle badge", () =>
    Effect.gen(function* () {
      const gate = yield* DualGate;
      expect(
        (yield* Hyperlink.readinessCheck(DualGate, gate)).ready,
      ).toBe(true);

      yield* gate.pause;
      expect(
        (yield* Hyperlink.readinessCheck(DualGate, gate)).ready,
      ).toBe(true);

      yield* gate.stop;
      expect(
        (yield* Hyperlink.readinessCheck(DualGate, gate)).ready,
      ).toBe(false);
    }).pipe(Effect.provide(DualGate.layer), Effect.scoped),
  );

  it.live("Hyperlink.deferStart mints Idle until Lifecycle.start", () =>
    Effect.gen(function* () {
      const gate = yield* DualGate;
      expect((yield* gate.lifecycle.get)._tag).toBe("Idle");
      expect(
        (yield* Hyperlink.readinessCheck(DualGate, gate)).ready,
      ).toBe(true);

      // Idle still admits (badge / readiness, not a hard reject).
      expect(yield* gate.run(7)).toBe(7);

      yield* Lifecycle.start(DualGate);
      expect((yield* gate.lifecycle.get)._tag).toBe("Running");
    }).pipe(
      Effect.provide(DualGate.layer.pipe(Hyperlink.deferStart)),
      Effect.scoped,
    ),
  );
});
