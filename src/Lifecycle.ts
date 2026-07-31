/**
 * Lifecycle — Effect-shaped control panel for HyperService runtime lifetime.
 *
 * Composes {@link FiberHandle} / {@link FiberSet}, optional {@link Latch}, and a
 * {@link SubscriptionRef} badge. Discriminated unions use `_tag` everywhere — State,
 * Event, and errors — so tools match with `Match` / {@link Hyperlink.runForEachTag} /
 * `Effect.catchTag`.
 *
 * ## Implementation
 *
 * ```ts
 * const latch = yield* Latch.make(true)
 * const lc = yield* Lifecycle.make({
 *   run: workerLoop,
 *   latch,
 *   release: windDown,
 *   restartable: false,
 * })
 * ```
 *
 * ## Tools
 *
 * ```ts
 * const lc = yield* Lifecycle.from(Jobs)
 * yield* lc.state.get                    // { _tag: "Idle" } | …
 * yield* lc.events.pipe(Hyperlink.runForEachTag({
 *   Started: () => Effect.log("up"),
 *   Stopped: (e) => Effect.log(e.to._tag),
 * }))
 * yield* lc.pause.pipe(
 *   Effect.catchTag("LifecycleUnsupported", (e) => Effect.log(e.role)),
 * )
 * ```
 *
 * @module Lifecycle
 */
import {
  Data,
  Effect,
  FiberHandle,
  FiberSet,
  type Latch,
  PubSub,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import * as Hyperlink from "./Hyperlink";

// =============================================================================
// Role (method annotations — wire introspection)
// =============================================================================

/**
 * Lifecycle **role** on a Spec method — PascalCase, inert to the wire. Tools read it via
 * `Hyperlink.methodMeta`.
 *
 * @category models
 * @public
 */
export type Role = "State" | "Start" | "Pause" | "Resume" | "Stop";

type Annotatable<R extends Role, Out> = {
  readonly annotate: (annotations: { readonly lifecycle: R }) => Out;
};

const role =
  <R extends Role>(lifecycle: R) =>
  <Out>(method: Annotatable<R, Out>): Out =>
    method.annotate({ lifecycle });

/** Mark the reactive {@link State} field. @category combinators @public */
export const state = role("State");

/** Mark the start command. @category combinators @public */
export const start = role("Start");

/** Mark the pause command. @category combinators @public */
export const pause = role("Pause");

/** Mark the resume command. @category combinators @public */
export const resume = role("Resume");

/** Mark the stop command. @category combinators @public */
export const stop = role("Stop");

/**
 * Sugar: `.pipe(Lifecycle.lifecycle("Pause"))` — prefer the named combinators above.
 *
 * @category combinators
 * @public
 */
export const lifecycle = <R extends Role>(lifecycleRole: R) => role(lifecycleRole);

// =============================================================================
// State — tagged ADT (wire + runtime)
// =============================================================================

/** @category schemas @public */
export const Idle = Schema.TaggedStruct("Idle", {});
/** @category schemas @public */
export const Running = Schema.TaggedStruct("Running", {});
/** @category schemas @public */
export const Paused = Schema.TaggedStruct("Paused", {});
/** @category schemas @public */
export const Draining = Schema.TaggedStruct("Draining", {});
/** @category schemas @public */
export const Off = Schema.TaggedStruct("Off", {});

/**
 * Shared lifecycle badge — tagged union. Match on `_tag`.
 *
 * @category schemas
 * @public
 */
export const State = Schema.Union([Idle, Running, Paused, Draining, Off]);

/**
 * Shared lifecycle badge. Success schema of a Role `"State"` field.
 *
 * @category models
 * @public
 */
export type State = typeof State.Type;

/**
 * State values — plain constants (empty tagged structs; no constructor args).
 * Schemas above are `Idle` / `Running` / …; these lowercase bindings are runtime badges.
 *
 * @category constructors
 * @public
 */
export const idle: typeof Idle.Type = { _tag: "Idle" };
/** @category constructors @public */
export const running: typeof Running.Type = { _tag: "Running" };
/** @category constructors @public */
export const paused: typeof Paused.Type = { _tag: "Paused" };
/** @category constructors @public */
export const draining: typeof Draining.Type = { _tag: "Draining" };
/** @category constructors @public */
export const off: typeof Off.Type = { _tag: "Off" };

/** Terminal badge after stop — Idle (restartable) or Off. @category models @public */
export type Terminal = typeof Idle.Type | typeof Off.Type;

// =============================================================================
// Events — tagged ADT (wire + runtime)
// =============================================================================

/** @category schemas @public */
export const Started = Schema.TaggedStruct("Started", {});
/** @category schemas @public */
export const EventPaused = Schema.TaggedStruct("Paused", {});
/** @category schemas @public */
export const Resumed = Schema.TaggedStruct("Resumed", {});
/** @category schemas @public */
export const StopRequested = Schema.TaggedStruct("StopRequested", {});
/** @category schemas @public */
export const Stopped = Schema.TaggedStruct("Stopped", {
  to: Schema.Union([Idle, Off]),
});

/**
 * Transition facts on {@link Service.events}. Match with `_tag` /
 * {@link Hyperlink.runForEachTag}. Separate from WorkPool item/queue events.
 *
 * @category schemas
 * @public
 */
export const Event = Schema.Union([
  Started,
  EventPaused,
  Resumed,
  StopRequested,
  Stopped,
]);

/**
 * @category models
 * @public
 */
export type Event = typeof Event.Type;

// =============================================================================
// Errors — Data.TaggedError so Effect.catchTag works
// =============================================================================

/**
 * Role not supported by this service (e.g. Daemon has no Pause).
 *
 * @example
 * lc.pause.pipe(
 *   Effect.catchTag("LifecycleUnsupported", (e) => Effect.log(e.role)),
 * )
 *
 * @category errors
 * @public
 */
export class Unsupported extends Data.TaggedError("LifecycleUnsupported")<{
  readonly role: Role;
}> {}

/**
 * Illegal transition for the current {@link State}.
 *
 * @example
 * lc.start.pipe(
 *   Effect.catchTag("LifecycleIllegal", (e) =>
 *     Effect.log(`${e.op} from ${e.from._tag}`),
 *   ),
 * )
 *
 * @category errors
 * @public
 */
export class Illegal extends Data.TaggedError("LifecycleIllegal")<{
  readonly from: State;
  readonly op: Role;
}> {}

// =============================================================================
// Service
// =============================================================================

/**
 * Core lifecycle handle — badge, transition events, start/stop.
 * {@link make} without a Latch returns this (no pause/resume on the type).
 *
 * @category models
 * @public
 */
export interface ServiceCore<R = never> {
  /** Live badge (`get` + `changes`) — elements are tagged {@link State}. */
  readonly state: Hyperlink.Subscribable<State>;
  /** Badge stream — same as `state.changes`. */
  readonly changes: Stream.Stream<State>;
  /** Transition events — match with {@link Hyperlink.runForEachTag}. */
  readonly events: Stream.Stream<Event>;
  /**
   * Idle → Running (or Paused if latch starts closed). Idempotent when already Running/Paused.
   * Fails {@link Illegal} from Draining/Off.
   */
  readonly start: Effect.Effect<void, Illegal, R>;
  /** → Draining → `release` → clear fibers → Off or Idle (`restartable`). Idempotent. */
  readonly stop: Effect.Effect<void, never, R>;
}

/**
 * Pausable lifecycle — {@link make} with a Latch.
 *
 * @category models
 * @public
 */
export interface ServicePausable<R = never> extends ServiceCore<R> {
  /** Running → Paused. Fails {@link Illegal} from other states. */
  readonly pause: Effect.Effect<void, Illegal, R>;
  /** Paused → Running. Fails {@link Illegal} from other states. */
  readonly resume: Effect.Effect<void, Illegal, R>;
}

/**
 * Tool-end handle — always has pause/resume (fail {@link Unsupported} when the
 * underlying service has no Latch). What {@link of} / {@link from} return.
 *
 * @category models
 * @public
 */
export interface Service<R = never> extends ServiceCore<R> {
  /** Running → Paused. Fails {@link Unsupported} when no Latch; {@link Illegal} from other states. */
  readonly pause: Effect.Effect<void, Unsupported | Illegal, R>;
  /** Paused → Running. Fails {@link Unsupported} when no Latch; {@link Illegal} from other states. */
  readonly resume: Effect.Effect<void, Unsupported | Illegal, R>;
}

/**
 * A HyperService (or narrow bag) that participates in the Lifecycle protocol.
 *
 * `lifecycleEvents` is named distinctly from domain `events` (WorkPool / Daemon run streams)
 * so {@link from} can project a full Tag service safely.
 *
 * @category models
 * @public
 */
export interface Participating<R = never> {
  readonly lifecycle: Hyperlink.Subscribable<State>;
  /** Lifecycle transition stream ({@link Event}) — not queue/daemon domain events. */
  readonly lifecycleEvents?: Stream.Stream<Event>;
  readonly start: Effect.Effect<void, never, R>;
  readonly pause?: Effect.Effect<void, never, R>;
  readonly resume?: Effect.Effect<void, never, R>;
  readonly stop?: Effect.Effect<void, never, R>;
}

/**
 * Project a participating handle into {@link Service} — the **tool / co-located** end.
 *
 * Re-checks badge before `start` so {@link Illegal} surfaces even when the underlying
 * handle swallows it for a `never` wire channel.
 *
 * @category constructors
 * @public
 */
export const of = <R = never>(svc: Participating<R>): Service<R> => {
  const stopFx =
    svc.stop ?? Effect.die(new Unsupported({ role: "Stop" }));
  return {
    state: svc.lifecycle,
    changes: svc.lifecycle.changes,
    events: svc.lifecycleEvents ?? Stream.empty,
    start: Effect.gen(function* () {
      const cur = yield* svc.lifecycle.get;
      if (cur._tag === "Draining" || cur._tag === "Off") {
        return yield* new Illegal({ from: cur, op: "Start" });
      }
      yield* svc.start;
    }),
    pause: Effect.gen(function* () {
      if (svc.pause === undefined) {
        return yield* new Unsupported({ role: "Pause" });
      }
      yield* svc.pause;
    }),
    resume: Effect.gen(function* () {
      if (svc.resume === undefined) {
        return yield* new Unsupported({ role: "Resume" });
      }
      yield* svc.resume;
    }),
    stop: stopFx,
  };
};

/**
 * `Effect.map(tag, of)` — `yield* Lifecycle.from(Jobs)`.
 * Projects only Participating fields (ignores domain `events`).
 *
 * @category constructors
 * @public
 */
export const from = <RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<Service<RR>, E, R> =>
  Effect.map(tag, (svc) =>
    of({
      lifecycle: svc.lifecycle,
      ...(svc.lifecycleEvents !== undefined
        ? { lifecycleEvents: svc.lifecycleEvents }
        : {}),
      start: svc.start,
      ...(svc.pause !== undefined ? { pause: svc.pause } : {}),
      ...(svc.resume !== undefined ? { resume: svc.resume } : {}),
      ...(svc.stop !== undefined ? { stop: svc.stop } : {}),
    }),
  );

// =============================================================================
// make — Effect-shaped implementation end
// =============================================================================

/**
 * Options for {@link make}.
 *
 * @category models
 * @public
 */
export interface MakeOptions<R = never> {
  /**
   * Effect body installed into a {@link FiberHandle} (default) or {@link FiberSet}.
   * `start` runs it; `stop` clears the fiber(s) after optional {@link release}.
   */
  readonly run: Effect.Effect<void, never, R>;
  /**
   * Pause gate. When present, {@link Service.pause} / {@link Service.resume} close / open it.
   * When omitted, those methods fail {@link Unsupported}.
   */
  readonly latch?: Latch.Latch;
  /**
   * Wind-down before fiber clear (e.g. initiate WorkPool drain). Awaited during {@link Service.stop}.
   */
  readonly release?: Effect.Effect<void, never, R>;
  /**
   * Optional second wait after {@link release} (e.g. await queue empty) before clearing
   * fibers and publishing the terminal badge.
   */
  readonly awaitBeforeTerminal?: Effect.Effect<void, never, R>;
  /**
   * After stop: `true` → Idle (restartable, Daemon); `false` → Off (WorkPool). Default `false`.
   */
  readonly restartable?: boolean;
  /**
   * `"handle"` (default) — one supervisor fiber via {@link FiberHandle}.
   * `"set"` — install `run` once into a {@link FiberSet}.
   */
  readonly fiber?: "handle" | "set";
}

/**
 * Build a lifecycle handle from Effect concurrency primitives.
 *
 * - With `latch` → {@link ServicePausable} (pause/resume on the type).
 * - Without `latch` → {@link ServiceCore} (no pause/resume members).
 *
 * Reads ambient {@link Hyperlink.DeferStart}: when `true`, stays Idle until {@link Service.start};
 * otherwise runs `run` during `make`. Scope close runs {@link Service.stop}.
 *
 * @category constructors
 * @public
 */
export function make<R = never>(
  options: MakeOptions<R> & { readonly latch: Latch.Latch },
): Effect.Effect<ServicePausable<R>, never, R | Scope.Scope>;
export function make<R = never>(
  options: MakeOptions<R> & { readonly latch?: undefined },
): Effect.Effect<ServiceCore<R>, never, R | Scope.Scope>;
export function make<R = never>(
  options: MakeOptions<R>,
): Effect.Effect<ServiceCore<R> | ServicePausable<R>, never, R | Scope.Scope>;
export function make<R = never>(
  options: MakeOptions<R>,
): Effect.Effect<ServiceCore<R> | ServicePausable<R>, never, R | Scope.Scope> {
  return Effect.gen(function* () {
    const restartable = options.restartable ?? false;
    const afterStop: Terminal = restartable ? idle : off;
    const fiberMode = options.fiber ?? "handle";
    const deferred = yield* Hyperlink.DeferStart;
    const context = yield* Effect.context<R>();

    const stateRef = yield* SubscriptionRef.make<State>(idle);
    const eventsHub = yield* PubSub.unbounded<Event>();
    const publish = (event: Event) =>
      PubSub.publish(eventsHub, event).pipe(Effect.asVoid);
    const setState = (next: State) => SubscriptionRef.set(stateRef, next);

    const handle =
      fiberMode === "handle"
        ? yield* FiberHandle.make<void, never>()
        : undefined;
    const fiberSet =
      fiberMode === "set" ? yield* FiberSet.make<void, never>() : undefined;

    let installed = false;

    const installRun: Effect.Effect<void, never, R> = Effect.gen(function* () {
      if (installed) return;
      installed = true;
      if (handle !== undefined) {
        yield* FiberHandle.run(handle, options.run);
      } else if (fiberSet !== undefined) {
        yield* FiberSet.run(fiberSet, options.run);
      }
    });

    const clearFibers: Effect.Effect<void> = Effect.gen(function* () {
      if (handle !== undefined) {
        yield* FiberHandle.clear(handle);
      } else if (fiberSet !== undefined) {
        yield* FiberSet.clear(fiberSet);
        yield* FiberSet.awaitEmpty(fiberSet);
      }
      installed = false;
    });

    const startFx: Effect.Effect<void, Illegal, R> = Effect.gen(function* () {
      const cur = yield* SubscriptionRef.get(stateRef);
      if (cur._tag === "Running" || cur._tag === "Paused") return;
      if (cur._tag === "Draining" || cur._tag === "Off") {
        return yield* new Illegal({ from: cur, op: "Start" });
      }
      yield* installRun;
      if (options.latch !== undefined) {
        yield* setState(options.latch.isOpen() ? running : paused);
      } else {
        yield* setState(running);
      }
      yield* publish({ _tag: "Started" });
    });

    const gate = options.latch;
    const pauseFx: Effect.Effect<void, Illegal, R> | undefined =
      gate === undefined
        ? undefined
        : Effect.gen(function* () {
            const cur = yield* SubscriptionRef.get(stateRef);
            if (cur._tag === "Paused") return;
            if (cur._tag !== "Running") {
              return yield* new Illegal({ from: cur, op: "Pause" });
            }
            yield* gate.close;
            yield* setState(paused);
            yield* publish({ _tag: "Paused" });
          });

    const resumeFx: Effect.Effect<void, Illegal, R> | undefined =
      gate === undefined
        ? undefined
        : Effect.gen(function* () {
            const cur = yield* SubscriptionRef.get(stateRef);
            if (cur._tag === "Running") return;
            if (cur._tag !== "Paused") {
              return yield* new Illegal({ from: cur, op: "Resume" });
            }
            yield* gate.open;
            yield* setState(running);
            yield* publish({ _tag: "Resumed" });
          });

    const stopFx: Effect.Effect<void, never, R> = Effect.gen(function* () {
      const cur = yield* SubscriptionRef.get(stateRef);
      if (cur._tag === "Off" || cur._tag === "Draining") return;
      if (cur._tag === "Idle" && !installed) {
        yield* setState(afterStop);
        yield* publish({ _tag: "Stopped", to: afterStop });
        return;
      }
      yield* setState(draining);
      yield* publish({ _tag: "StopRequested" });
      if (options.release !== undefined) {
        yield* options.release;
      }
      if (options.awaitBeforeTerminal !== undefined) {
        yield* options.awaitBeforeTerminal;
      }
      yield* clearFibers;
      yield* setState(afterStop);
      yield* publish({ _tag: "Stopped", to: afterStop });
    });

    yield* Effect.addFinalizer(() =>
      stopFx.pipe(Effect.provide(context), Effect.orDie),
    );

    if (!deferred) {
      yield* startFx.pipe(
        Effect.catchTag("LifecycleIllegal", () => Effect.void),
      );
    }

    const stateSub: Hyperlink.Subscribable<State> = {
      get: SubscriptionRef.get(stateRef),
      changes: SubscriptionRef.changes(stateRef),
    };

    const events = Stream.unwrap(
      PubSub.subscribe(eventsHub).pipe(
        Effect.map((sub) => Stream.fromSubscription(sub)),
      ),
    );
    const core: ServiceCore<R> = {
      state: stateSub,
      changes: stateSub.changes,
      events,
      start: startFx,
      stop: stopFx,
    };
    if (pauseFx === undefined || resumeFx === undefined) {
      return core;
    }
    return {
      ...core,
      pause: pauseFx,
      resume: resumeFx,
    } satisfies ServicePausable<R>;
  });
}

// =============================================================================
// Spec / impl sugar
// =============================================================================

/**
 * Spec fragment for Lifecycle participation.
 *
 * @category constructors
 * @public
 */
export const spec = (options?: { readonly pausable?: boolean }) => {
  const pausable = options?.pausable ?? false;
  const base = {
    lifecycle: Hyperlink.ref(State)
      .annotate({
        description:
          "Lifecycle badge ({ _tag: Idle | Running | Paused | Draining | Off }).",
      })
      .pipe(state),
    lifecycleEvents: Hyperlink.stream(Event).annotate({
      description:
        "Lifecycle transition events (Started / Paused / Resumed / StopRequested / Stopped).",
    }),
    start: Hyperlink.effect(Schema.Void)
      .annotate({ description: "Start the service (Idle → Running)." })
      .pipe(start),
    stop: Hyperlink.effect(Schema.Void)
      .annotate({
        description: "Stop the service (→ Draining → Off or Idle).",
        destructive: true,
      })
      .pipe(stop),
  };
  if (!pausable) return base;
  return {
    ...base,
    pause: Hyperlink.effect(Schema.Void)
      .annotate({ description: "Pause processing (Latch.close)." })
      .pipe(pause),
    resume: Hyperlink.effect(Schema.Void)
      .annotate({ description: "Resume processing (Latch.open)." })
      .pipe(resume),
  };
};

/**
 * Impl fragment from a {@link Service} — spread into `Hyperlink.serve` / toolkit impls.
 *
 * @category constructors
 * @public
 */
export const impl = <R = never>(
  lc: ServiceCore<R> | ServicePausable<R> | Service<R>,
): {
  readonly lifecycle: Hyperlink.Subscribable<State>;
  readonly lifecycleEvents: Stream.Stream<Event>;
  readonly start: Effect.Effect<void, Illegal, R>;
  readonly pause?: Effect.Effect<void, Unsupported | Illegal, R>;
  readonly resume?: Effect.Effect<void, Unsupported | Illegal, R>;
  readonly stop: Effect.Effect<void, never, R>;
} => ({
  lifecycle: lc.state,
  lifecycleEvents: lc.events,
  start: lc.start,
  ...("pause" in lc ? { pause: lc.pause } : {}),
  ...("resume" in lc ? { resume: lc.resume } : {}),
  stop: lc.stop,
});

/**
 * Spec-field helpers: stamp + schema for the Role `"State"` member.
 *
 * @category constructors
 * @public
 */
export const stateSchema = State;
