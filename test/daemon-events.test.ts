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
import * as Hyperlink from "../src/Hyperlink";
import { builtInDaemonStoreContract } from "../src/internal/store/daemonStoreSpec";
import { flattenHyperlinkSpec } from "../src/Hyperlink";
import type { AnyMethod } from "../src/Hyperlink";

const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

/** Disarmed so we can subscribe before emitting, then drive with `run`. */
class LiveEventsProc extends Daemon.Tag<LiveEventsProc>()(
  "test/daemon-events/Live",
).pipe(Daemon.schedule([])) {}

class TypedFailProc extends Daemon.Tag<TypedFailProc>()("test/daemon-events/TypedFail", {
  error: FetchErr,
}).pipe(Daemon.schedule([])) {}

class StringFailProc extends Daemon.Tag<StringFailProc>()(
  "test/daemon-events/StringFail",
).pipe(Daemon.schedule([])) {}

class InterruptProc extends Daemon.Tag<InterruptProc>()(
  "test/daemon-events/Interrupt",
).pipe(Daemon.schedule([])) {}

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class SuccessEventsProc extends Daemon.Tag<SuccessEventsProc>()(
  "test/daemon-events/Success",
  { success: Price },
).pipe(Daemon.schedule([])) {}

class Boom extends Data.TaggedError("Boom")<{ readonly code: number }> {}

type LiveEventsProcService = Effect.Success<typeof LiveEventsProc>;
const LiveEventsProcEffect: Effect.Effect<LiveEventsProcService, never, LiveEventsProc> =
  LiveEventsProc;
const liveEventsLayer = <A, E>(
  effect: Effect.Effect<A, E, never>,
): Layer.Layer<
  LiveEventsProc | LiveEventsProcService | Hyperlink.Local<LiveEventsProcService> | Store.Storage,
  never,
  never
> => Daemon.layer(LiveEventsProc, { effect });
const liveEventsMemoryLayer = <A, E>(
  effect: Effect.Effect<A, E, never>,
): Layer.Layer<
  LiveEventsProc | LiveEventsProcService | Hyperlink.Local<LiveEventsProcService> | Store.Storage,
  never,
  never
> => Daemon.layerMemory(LiveEventsProc, { effect });

type TypedFailProcService = Effect.Success<typeof TypedFailProc>;
const TypedFailProcEffect: Effect.Effect<TypedFailProcService, never, TypedFailProc> =
  TypedFailProc;
const typedFailLayer = <A, E>(
  effect: Effect.Effect<A, E, never>,
): Layer.Layer<
  TypedFailProc | TypedFailProcService | Hyperlink.Local<TypedFailProcService> | Store.Storage,
  never,
  never
> => Daemon.layerMemory(TypedFailProc, { effect });

type StringFailProcService = Effect.Success<typeof StringFailProc>;
const StringFailProcEffect: Effect.Effect<StringFailProcService, never, StringFailProc> =
  StringFailProc;
const stringFailLayer = <A, E>(
  effect: Effect.Effect<A, E, never>,
): Layer.Layer<
  StringFailProc | StringFailProcService | Hyperlink.Local<StringFailProcService> | Store.Storage,
  never,
  never
> => Daemon.layerMemory(StringFailProc, { effect });

type InterruptProcService = Effect.Success<typeof InterruptProc>;
const InterruptProcEffect: Effect.Effect<InterruptProcService, never, InterruptProc> =
  InterruptProc;
const interruptLayer = <A, E>(
  effect: Effect.Effect<A, E, never>,
): Layer.Layer<
  InterruptProc | InterruptProcService | Hyperlink.Local<InterruptProcService> | Store.Storage,
  never,
  never
> => Daemon.layer(InterruptProc, { effect });

type SuccessEventsProcService = Effect.Success<typeof SuccessEventsProc>;
const SuccessEventsProcEffect: Effect.Effect<
  SuccessEventsProcService,
  never,
  SuccessEventsProc
> = SuccessEventsProc;
const successEventsLayer = (
  effect: Effect.Effect<typeof Price.Type, never, never>,
): Layer.Layer<
  | SuccessEventsProc
  | SuccessEventsProcService
  | Hyperlink.Local<SuccessEventsProcService>
  | Store.Storage,
  never,
  never
> => Daemon.layerMemory(SuccessEventsProc, { effect });

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
  it("buildDaemonSpec / daemonSpec expose events as a stream method", () => {
    const flat = flattenHyperlinkSpec(Daemon.daemonSpec);
    const events = asRpcMethod(flat.events);
    expect(events?.stream).toBe(true);
  });
});

describe("Daemon.events — live stream", () => {
  it.live("emits Started → Completed for a successful manual run", () =>
    Effect.gen(function* () {
      const proc = yield* LiveEventsProcEffect;
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(proc.events, 2)),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* proc.run;
      const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
      expect(tags).toEqual(["Started", "Completed"]);
    }).pipe(
      Effect.provide(liveEventsMemoryLayer(Effect.void)),
      Effect.scoped,
    ),
  );

  it.live("emits Failed when the run body fails (no error stamp → string)", () =>
    Effect.gen(function* () {
      const proc = yield* StringFailProcEffect;
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
        stringFailLayer(Effect.fail(new Boom({ code: 7 }))),
      ),
      Effect.scoped,
    ),
  );

  it.live("Failed carries the stamped typed error on events", () =>
    Effect.gen(function* () {
      const proc = yield* TypedFailProcEffect;
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
        typedFailLayer(Effect.fail({ _tag: "FetchError" as const, status: 503 })),
      ),
      Effect.scoped,
    ),
  );

  it.live("Completed.success carries the stamped success value on events", () =>
    Effect.gen(function* () {
      const proc = yield* SuccessEventsProcEffect;
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
        successEventsLayer(Effect.succeed({ symbol: "AAPL", usd: 42 })),
      ),
      Effect.scoped,
    ),
  );

  it.live("live events match store rows for the same run (persist == stream)", () =>
    Effect.gen(function* () {
      const proc = yield* LiveEventsProcEffect;
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
        withStore(liveEventsLayer(Effect.void)),
      ),
      Effect.scoped,
    ),
  );

  it.live("emits Interrupted when a manual run fiber is interrupted", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void, never>();
      const hold = yield* Deferred.make<void, never>();
      const live = withStore(
        interruptLayer(
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, void 0);
            yield* Deferred.await(hold);
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const proc = yield* InterruptProcEffect;
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
      const handle = Daemon.make("test/daemon-events/direct", {
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
