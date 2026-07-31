/**
 * Lifecycle — Effect-native control panel over FiberHandle / FiberSet + optional Latch.
 *
 * Compose real concurrency primitives; drive them with dual ops (`Lifecycle.start(lc)`).
 * The same duals accept a wire {@link Participating} handle (`Lifecycle.start(jobs)`).
 * Badge is a {@link SubscriptionRef}; transition {@link Event}s are derived from
 * `state` changes (no parallel PubSub). Heavy engine: `internal/lifecycle`.
 *
 * ## Implementation
 *
 * ```ts
 * const latch = yield* Latch.make(true)
 * const lc = yield* Lifecycle.make({
 *   run: workerLoop,
 *   latch,
 *   release: windDown,
 *   afterStop: Lifecycle.off,
 * })
 * yield* Lifecycle.start(lc)
 * yield* Lifecycle.pause(lc)
 * yield* Lifecycle.stop(lc) // same path as Scope finalizer
 * ```
 *
 * ## Tools
 *
 * ```ts
 * const jobs = yield* Jobs
 * yield* Lifecycle.start(jobs)
 * yield* jobs.lifecycle.get
 * yield* Lifecycle.events(jobs).pipe(Hyperlink.runForEachTag({
 *   Started: () => Effect.log("up"),
 *   Stopped: (e) => Effect.log(e.to._tag),
 * }))
 * ```
 *
 * @module Lifecycle
 */
import { Effect, Schema, Stream } from "effect";
import * as Hyperlink from "./Hyperlink";
import * as engine from "./internal/lifecycle";
import type { Lifecycle as LifecycleHandle } from "./internal/lifecycleModel";
import * as model from "./internal/lifecycleModel";
import { isLifecycle } from "./internal/lifecycleModel";

// =============================================================================
// Model re-exports
// =============================================================================

export {
  Draining,
  Event,
  EventPaused,
  Idle,
  Illegal,
  Off,
  Paused,
  Resumed,
  Running,
  Started,
  State,
  StopRequested,
  Stopped,
  Unsupported,
  draining,
  idle,
  isLifecycle,
  off,
  paused,
  running,
} from "./internal/lifecycleModel";

export type {
  Fibers,
  Lifecycle,
  LifecycleCore,
  LifecyclePausable,
  MakeOptions,
  Terminal,
} from "./internal/lifecycleModel";

/** @category constructors @public */
export const make = engine.make;

// =============================================================================
// Role (method annotations — wire introspection)
// =============================================================================

/**
 * Lifecycle **role** on a Spec method — PascalCase, inert to the wire.
 *
 * @category models
 * @public
 */
export type Role = model.LifecycleRole;

type Annotatable<R extends Role, Out> = {
  readonly annotate: (annotations: { readonly lifecycle: R }) => Out;
};

const role =
  <R extends Role>(lifecycle: R) =>
  <Out>(method: Annotatable<R, Out>): Out =>
    method.annotate({ lifecycle });

/** Mark the reactive State field. @category combinators @public */
export const state = role("State");

/** Spec Role stamp — `.pipe(Lifecycle.asStart)`. @category combinators @public */
export const asStart = role("Start");
/** Spec Role stamp — `.pipe(Lifecycle.asPause)`. @category combinators @public */
export const asPause = role("Pause");
/** Spec Role stamp — `.pipe(Lifecycle.asResume)`. @category combinators @public */
export const asResume = role("Resume");
/** Spec Role stamp — `.pipe(Lifecycle.asStop)`. @category combinators @public */
export const asStop = role("Stop");

/**
 * Sugar: `.pipe(Lifecycle.lifecycle("Pause"))` — prefer {@link asPause}.
 *
 * @category combinators
 * @public
 */
export const lifecycle = <R extends Role>(lifecycleRole: R) => role(lifecycleRole);

// =============================================================================
// Participating — wire HyperService surface (tools)
// =============================================================================

/**
 * A HyperService that participates in the Lifecycle protocol.
 *
 * @category models
 * @public
 */
export interface Participating<R = never> {
  readonly lifecycle: Hyperlink.Subscribable<model.State>;
  readonly lifecycleEvents?: Stream.Stream<model.Event>;
  readonly start: Effect.Effect<void, never, R>;
  readonly pause?: Effect.Effect<void, never, R>;
  readonly resume?: Effect.Effect<void, never, R>;
  readonly stop?: Effect.Effect<void, never, R>;
}

type Controllable<R = never> = LifecycleHandle<R> | Participating<R>;

const isParticipating = <R>(self: Controllable<R>): self is Participating<R> =>
  !isLifecycle<R>(self);

/**
 * Transition events — derived from badge changes on a {@link Lifecycle} handle,
 * or the wire `lifecycleEvents` stream on a {@link Participating} service.
 *
 * @category observers
 * @public
 */
export const events = <R>(
  self: Controllable<R>,
): Stream.Stream<model.Event> =>
  isParticipating(self)
    ? (self.lifecycleEvents ?? Stream.empty)
    : engine.events(self);

/**
 * Start — FiberHandle.run on a Lifecycle handle, or the wire `start` on Participating
 * (re-checks Off/Draining → {@link Illegal}).
 *
 * @category combinators
 * @public
 */
export const start = <R>(
  self: Controllable<R>,
): Effect.Effect<void, model.Illegal, R> => {
  if (isParticipating(self)) {
    return Effect.gen(function* () {
      const cur = yield* self.lifecycle.get;
      if (cur._tag === "Draining" || cur._tag === "Off") {
        return yield* new model.Illegal({ from: cur, op: "Start" });
      }
      yield* self.start;
    });
  }
  return engine.start(self);
};

/**
 * Pause — Latch.close on a Lifecycle handle, or wire `pause` on Participating.
 *
 * @category combinators
 * @public
 */
export const pause = <R>(
  self: Controllable<R>,
): Effect.Effect<void, model.Unsupported | model.Illegal, R> => {
  if (isParticipating(self)) {
    return Effect.gen(function* () {
      if (self.pause === undefined) {
        return yield* new model.Unsupported({ role: "Pause" });
      }
      yield* self.pause;
    });
  }
  return engine.pause(self);
};

/**
 * Resume — Latch.open on a Lifecycle handle, or wire `resume` on Participating.
 *
 * @category combinators
 * @public
 */
export const resume = <R>(
  self: Controllable<R>,
): Effect.Effect<void, model.Unsupported | model.Illegal, R> => {
  if (isParticipating(self)) {
    return Effect.gen(function* () {
      if (self.resume === undefined) {
        return yield* new model.Unsupported({ role: "Resume" });
      }
      yield* self.resume;
    });
  }
  return engine.resume(self);
};

/**
 * Stop — clear fibers / finalizer path on a Lifecycle handle, or wire `stop`.
 *
 * @category combinators
 * @public
 */
export const stop = <R>(
  self: Controllable<R>,
): Effect.Effect<void, never, R> => {
  if (isParticipating(self)) {
    return self.stop ?? Effect.die(new model.Unsupported({ role: "Stop" }));
  }
  return engine.stop(self);
};

/**
 * `Effect.flatMap(tag, start)` — `yield* Lifecycle.startFrom(Jobs)`.
 *
 * @category constructors
 * @public
 */
export const startFrom = <RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E | model.Illegal, R | RR> =>
  Effect.flatMap(tag, start);

/** @category constructors @public */
export const pauseFrom = <RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E | model.Unsupported | model.Illegal, R | RR> =>
  Effect.flatMap(tag, pause);

/** @category constructors @public */
export const resumeFrom = <RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E | model.Unsupported | model.Illegal, R | RR> =>
  Effect.flatMap(tag, resume);

/** @category constructors @public */
export const stopFrom = <RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E, R | RR> => Effect.flatMap(tag, stop);

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
    lifecycle: Hyperlink.ref(model.State)
      .annotate({
        description:
          "Lifecycle badge ({ _tag: Idle | Running | Paused | Draining | Off }).",
      })
      .pipe(state),
    lifecycleEvents: Hyperlink.stream(model.Event).annotate({
      description:
        "Lifecycle transition events derived from badge changes (Started / Paused / Resumed / StopRequested / Stopped).",
    }),
    start: Hyperlink.effect(Schema.Void)
      .annotate({ description: "Start the service (Idle → Running)." })
      .pipe(asStart),
    stop: Hyperlink.effect(Schema.Void)
      .annotate({
        description: "Stop the service (→ Draining → Off or Idle).",
        destructive: true,
      })
      .pipe(asStop),
  };
  if (!pausable) return base;
  return {
    ...base,
    pause: Hyperlink.effect(Schema.Void)
      .annotate({ description: "Pause processing (Latch.close)." })
      .pipe(asPause),
    resume: Hyperlink.effect(Schema.Void)
      .annotate({ description: "Resume processing (Latch.open)." })
      .pipe(asResume),
  };
};

/**
 * Impl fragment from a Lifecycle handle — spread into toolkit / serve impls.
 *
 * @category constructors
 * @public
 */
export const impl = <R = never>(
  lc: LifecycleHandle<R>,
): {
  readonly lifecycle: Hyperlink.Subscribable<model.State>;
  readonly lifecycleEvents: Stream.Stream<model.Event>;
  readonly start: Effect.Effect<void, model.Illegal, R>;
  readonly pause?: Effect.Effect<void, model.Illegal | model.Unsupported, R>;
  readonly resume?: Effect.Effect<void, model.Illegal | model.Unsupported, R>;
  readonly stop: Effect.Effect<void, never, R>;
} => ({
  lifecycle: Hyperlink.subscribable(lc.state),
  lifecycleEvents: engine.events(lc),
  start: engine.start(lc),
  ...(lc.latch !== undefined
    ? {
        pause: engine.pause(lc),
        resume: engine.resume(lc),
      }
    : {}),
  stop: engine.stop(lc),
});

/**
 * Spec-field helpers: stamp + schema for the Role `"State"` member.
 *
 * @category constructors
 * @public
 */
export const stateSchema = model.State;
