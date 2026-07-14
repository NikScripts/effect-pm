/**
 * Process live `events` stream — Queue-aligned (persist == stream).
 */
import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import * as Process from "../src/Process";
import * as Store from "../src/Store";
import { builtInProcessStoreContract } from "../src/internal/store/processStoreSpec";
import { flattenResourceSpec } from "../src/Resource";
import type { AnyMethod } from "../src/Resource";

const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

/** Disarmed so we can subscribe before emitting, then drive with `run`. */
class LiveEventsProc extends Process.Tag<LiveEventsProc>()(
  "test/process-events/Live",
).pipe(Process.schedule([])) {}

class TypedFailProc extends Process.Tag<TypedFailProc>()("test/process-events/TypedFail", {
  error: FetchErr,
}).pipe(Process.schedule([])) {}

class StringFailProc extends Process.Tag<StringFailProc>()(
  "test/process-events/StringFail",
).pipe(Process.schedule([])) {}

class InterruptProc extends Process.Tag<InterruptProc>()(
  "test/process-events/Interrupt",
).pipe(Process.schedule([])) {}

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class SuccessEventsProc extends Process.Tag<SuccessEventsProc>()(
  "test/process-events/Success",
  { success: Price },
).pipe(Process.schedule([])) {}

class Boom extends Data.TaggedError("Boom")<{ readonly code: number }> {}

class EventsStore extends Store.Service<EventsStore>("@test/ProcessEventsStore")(
  Store.register(LiveEventsProc, builtInProcessStoreContract(LiveEventsProc)),
  Store.register(TypedFailProc, builtInProcessStoreContract(TypedFailProc)),
  Store.register(StringFailProc, builtInProcessStoreContract(StringFailProc)),
  Store.register(InterruptProc, builtInProcessStoreContract(InterruptProc)),
  Store.register(SuccessEventsProc, builtInProcessStoreContract(SuccessEventsProc)),
) {}

const withStore = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Layer.provideMerge(EventsStore.layerMemory, layer);

const asRpcMethod = (m: unknown): AnyMethod | undefined =>
  m !== undefined && typeof m === "object" && m !== null && "kind" in m
    ? (m as AnyMethod)
    : undefined;

describe("Process.events — wire", () => {
  it("buildProcessSpec / processSpec expose events as a stream method", () => {
    const flat = flattenResourceSpec(Process.processSpec);
    const events = asRpcMethod(flat.events);
    expect(events?.stream).toBe(true);
  });
});

describe("Process.events — live stream", () => {
  it.live("emits Started → Completed for a successful manual run", () =>
    Effect.gen(function* () {
      const proc = yield* LiveEventsProc;
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(proc.events, 2)),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* proc.run;
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      expect(tags).toEqual(["Started", "Completed"]);
    }).pipe(
      Effect.provide(Process.layer(LiveEventsProc, { effect: Effect.void })),
      Effect.scoped,
    ),
  );

  it.live("emits Failed when the run body fails (no error stamp → string)", () =>
    Effect.gen(function* () {
      const proc = yield* StringFailProc;
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(proc.events, 2)),
      );
      yield* Effect.sleep(Duration.millis(20));
      const exit = yield* proc.run.pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      const events = Array.from(yield* Fiber.join(collected));
      expect(events.map((e) => e._tag)).toEqual(["Started", "Failed"]);
      const failed = events.find((e) => e._tag === "Failed");
      expect(failed?._tag).toBe("Failed");
      if (failed?._tag === "Failed") {
        expect(typeof failed.error).toBe("string");
        expect(failed.error).toContain("Boom");
      }
    }).pipe(
      Effect.provide(
        Process.layer(StringFailProc, {
          effect: Effect.fail(new Boom({ code: 7 })),
        }),
      ),
      Effect.scoped,
    ),
  );

  it.live("Failed carries the stamped typed error on events", () =>
    Effect.gen(function* () {
      const proc = yield* TypedFailProc;
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(proc.events, (e) => e._tag === "Failed"),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      const exit = yield* proc.run.pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      const err = Option.getOrThrow(
        Cause.findErrorOption(
          Exit.isFailure(exit) ? exit.cause : Cause.die("expected failure"),
        ),
      );
      expect((err as { readonly _tag: string })._tag).toBe("FetchError");
      const events = Array.from(yield* Fiber.join(collected));
      const failed = events.find((e) => e._tag === "Failed");
      expect(failed).toMatchObject({
        _tag: "Failed",
        error: { _tag: "FetchError", status: 503 },
      });
    }).pipe(
      Effect.provide(
        Process.layer(TypedFailProc, {
          effect: Effect.fail({ _tag: "FetchError" as const, status: 503 }),
        }),
      ),
      Effect.scoped,
    ),
  );

  it.live("Completed.success carries the stamped success value on events", () =>
    Effect.gen(function* () {
      const proc = yield* SuccessEventsProc;
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(proc.events, (e) => e._tag === "Completed"),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      const result = yield* proc.run;
      expect(result).toEqual({ symbol: "AAPL", usd: 42 });
      const events = Array.from(yield* Fiber.join(collected));
      expect(events.find((e) => e._tag === "Completed")).toMatchObject({
        _tag: "Completed",
        success: { symbol: "AAPL", usd: 42 },
      });
    }).pipe(
      Effect.provide(
        Process.layer(SuccessEventsProc, {
          effect: Effect.succeed({ symbol: "AAPL", usd: 42 }),
        }),
      ),
      Effect.scoped,
    ),
  );

  it.live("live events match store rows for the same run (persist == stream)", () =>
    Effect.gen(function* () {
      const proc = yield* LiveEventsProc;
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(proc.events, 2)),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* proc.run;
      const live = Array.from(yield* Fiber.join(collected));
      const store = yield* EventsStore.at(LiveEventsProc);
      const durable = yield* store.events();
      expect(live.map((e) => e._tag)).toEqual(["Started", "Completed"]);
      expect(durable.map((e) => e._tag)).toEqual(["Started", "Completed"]);
      expect(live).toEqual(durable);
    }).pipe(
      Effect.provide(
        withStore(Process.layer(LiveEventsProc, { effect: Effect.void })),
      ),
      Effect.scoped,
    ),
  );

  it.live("emits Interrupted when a manual run fiber is interrupted", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void, never>();
      const hold = yield* Deferred.make<void, never>();
      const live = withStore(
        Process.layer(InterruptProc, {
          effect: Effect.gen(function* () {
            yield* Deferred.succeed(entered, void 0);
            yield* Deferred.await(hold);
          }),
        }),
      );
      yield* Effect.gen(function* () {
        const proc = yield* InterruptProc;
        const collected = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.takeUntil(proc.events, (e) => e._tag === "Interrupted"),
          ),
        );
        yield* Effect.sleep(Duration.millis(20));
        // Manual `run` is independent of the supervisor — interrupt that fiber (stop only kills the driver).
        const runFiber = yield* Effect.forkChild(proc.run);
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(runFiber);
        const events = Array.from(yield* Fiber.join(collected));
        expect(events.some((e) => e._tag === "Interrupted")).toBe(true);
        expect(events.some((e) => e._tag === "Started")).toBe(true);
      }).pipe(Effect.provide(live), Effect.scoped);
    }),
  );
});

describe("Process.make — events without store", () => {
  it.live("publishes lifecycle on the engine handle even without a store", () =>
    Effect.gen(function* () {
      const handle = Process.make("test/process-events/direct", {
        effect: Effect.void,
        schedule: Process.scheduleInMemory(),
      });
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(handle.events, 2)),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* handle.run();
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      expect(tags).toEqual(["Started", "Completed"]);
    }).pipe(Effect.scoped),
  );
});
