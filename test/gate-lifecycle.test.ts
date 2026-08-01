import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
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

// Focused Lifecycle coverage for Gate (P10): pause holds new calls *and* existing waiters,
// stop rejects new calls with `GateStopped`, `stopMode` failWaiting vs finishWaiting, and
// live `setConcurrency` / `setRateLimit`.

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

describe("Gate — Lifecycle pause", () => {
  it.live("pause holds new calls until resume", () =>
    Effect.gen(function* () {
      const executed = yield* Ref.make(0);
      class PausableGate extends Gate.Service<PausableGate>()(
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
      class HoldWaitingGate extends Gate.Service<HoldWaitingGate>()(
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

        // run(1) holds the only permit; run(2) parks in the waiting phase.
        const inFlight = yield* Effect.forkChild(gate.run(1));
        yield* Deferred.await(started);
        const waiter = yield* Effect.forkChild(gate.run(2));
        yield* awaitCount(gate.waiting, 1);

        // Pause while the waiter is already queued — then free the permit.
        // P10: the waiter must NOT run its body until resume (second latch hold).
        yield* gate.pause;
        expect((yield* gate.lifecycle.get)._tag).toBe("Paused");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(inFlight);

        // Permit is free; waiter may have acquired it but must still be latch-held.
        yield* Effect.sleep(Duration.millis(50));
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
      class StoppableGate extends Gate.Service<StoppableGate>()(
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
        // Nothing in-flight: stop drains immediately then flips to Off.
        yield* gate.stop;
        expect((yield* gate.lifecycle.get)._tag).toBe("Off");

        // `GateStopped` is raised by the engine but erased from the wire `run` error channel
        // (declared error schema only), so match it through the runtime cause.
        const exit = yield* Effect.exit(gate.run(21));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(Gate.GateStopped);
        }
      }).pipe(Effect.provide(StoppableGate.layer), Effect.scoped);
    }),
  );

  it.live("failWaiting: stop fails callers waiting for a permit", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      class FailWaitingGate extends Gate.Service<FailWaitingGate>()(
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

        // run(1) grabs the single permit and blocks in-flight.
        const inFlight = yield* Effect.forkChild(gate.run(1));
        yield* Deferred.await(started);
        expect(yield* gate.inFlight.get).toBe(1);

        // run(2) can't get the permit → parks in the waiting phase.
        const waiter = yield* Effect.forkChild(Effect.exit(gate.run(2)));
        yield* awaitCount(gate.waiting, 1);

        // stop (failWaiting) fails the waiter, then blocks on the in-flight body.
        const stopFiber = yield* Effect.forkChild(gate.stop);
        const waiterExit = yield* Fiber.join(waiter);
        expect(Exit.isFailure(waiterExit)).toBe(true);
        if (Exit.isFailure(waiterExit)) {
          const err = Option.getOrThrow(
            Cause.findErrorOption(waiterExit.cause),
          );
          expect(err).toBeInstanceOf(Gate.GateStopped);
        }

        // Release the in-flight body → drain completes → Off.
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
      class FinishWaitingGate extends Gate.Service<FinishWaitingGate>()(
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

        // stop (finishWaiting) drains in-flight AND the waiter before flipping Off.
        const stopFiber = yield* Effect.forkChild(gate.stop);
        // Give stop time to enter Draining and open the latch before releasing the body.
        yield* Effect.sleep(Duration.millis(50));
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
      class ResizableGate extends Gate.Service<ResizableGate>()(
        "@test/lifecycle/ResizableGate",
        {
          payload: Schema.Number,
          success: Schema.Void,
          effect: (_n: number) =>
            Effect.gen(function* () {
              const n = yield* Ref.updateAndGet(active, (x) => x + 1);
              const p = yield* Ref.get(peak);
              if (n > p) yield* Ref.set(peak, n);
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

        // Functionally: with 3 permits, three bodies run concurrently.
        const f1 = yield* Effect.forkChild(gate.run(1));
        const f2 = yield* Effect.forkChild(gate.run(2));
        const f3 = yield* Effect.forkChild(gate.run(3));
        yield* Effect.sleep(Duration.millis(50));
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
      class RateGate extends Gate.Service<RateGate>()(
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

        // Clearing (null) bumps configVersion again.
        yield* gate.setRateLimit(null);
        expect((yield* gate.status.get).configVersion).toBe(3);
      }).pipe(Effect.provide(RateGate.layer), Effect.scoped);
    }),
  );
});
