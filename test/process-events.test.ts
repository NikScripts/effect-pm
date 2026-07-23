/**
 * Daemon live `events` stream — Queue-aligned (persist == stream).
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
import * as Daemon from "../src/Daemon";
import * as Store from "../src/Store";
import { builtInDaemonStoreContract } from "../src/internal/store/processStoreSpec";
import { flattenHyperlinkSpec } from "../src/Hyperlink";
import type { AnyMethod } from "../src/Hyperlink";

const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

/** Disarmed so we can subscribe before emitting, then drive with `run`. */
class LiveEventsProc extends Daemon.Tag<LiveEventsProc>()(
  "test/process-events/Live",
).pipe(Daemon.schedule([])) {}

class TypedFailProc extends Daemon.Tag<TypedFailProc>()("test/process-events/TypedFail", {
  error: FetchErr,
}).pipe(Daemon.schedule([])) {}

class StringFailProc extends Daemon.Tag<StringFailProc>()(
  "test/process-events/StringFail",
).pipe(Daemon.schedule([])) {}

class InterruptProc extends Daemon.Tag<InterruptProc>()(
  "test/process-events/Interrupt",
).pipe(Daemon.schedule([])) {}

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class SuccessEventsProc extends Daemon.Tag<SuccessEventsProc>()(
  "test/process-events/Success",
  { success: Price },
).pipe(Daemon.schedule([])) {}

class Boom extends Data.TaggedError("Boom")<{ readonly code: number }> {}

class EventsStore extends Store.Service<EventsStore>("@test/DaemonEventsStore")(
  Store.register(LiveEventsProc, builtInDaemonStoreContract(LiveEventsProc)),
  Store.register(TypedFailProc, builtInDaemonStoreContract(TypedFailProc)),
  Store.register(StringFailProc, builtInDaemonStoreContract(StringFailProc)),
  Store.register(InterruptProc, builtInDaemonStoreContract(InterruptProc)),
  Store.register(SuccessEventsProc, builtInDaemonStoreContract(SuccessEventsProc)),
) {}

const withStore = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(Layer.provideMerge(EventsStore.layerMemory));

const asRpcMethod = (m: unknown): AnyMethod | undefined =>
  m !== undefined && typeof m === "object" && m !== null && "kind" in m
    ? (m as AnyMethod)
    : undefined;

describe("Daemon.events — wire", () => {
  it("buildDaemonSpec / processSpec expose events as a stream method", () => {
    const flat = flattenHyperlinkSpec(Daemon.processSpec);
    const events = asRpcMethod(flat.events);
    expect(events?.stream).toBe(true);
  });
});

describe("Daemon.events — live stream", () => {
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
      Effect.provide(Daemon.layerMemory(LiveEventsProc, { effect: Effect.void })),
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
        Daemon.layerMemory(StringFailProc, {
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
        Daemon.layerMemory(TypedFailProc, {
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
        Daemon.layerMemory(SuccessEventsProc, {
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
        withStore(Daemon.layer(LiveEventsProc, { effect: Effect.void })),
      ),
      Effect.scoped,
    ),
  );

  it.live("emits Interrupted when a manual run fiber is interrupted", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void, never>();
      const hold = yield* Deferred.make<void, never>();
      const live = withStore(
        Daemon.layer(InterruptProc, {
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

describe("Daemon.make — events without store", () => {
  it.live("publishes lifecycle on the engine handle even without a store", () =>
    Effect.gen(function* () {
      const handle = Daemon.make("test/process-events/direct", {
        effect: Effect.void,
        schedule: Daemon.scheduleInMemory(),
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
