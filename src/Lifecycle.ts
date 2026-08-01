/**
 * Lifecycle — Effect-native control panel over FiberHandle / FiberSet + optional Latch.
 *
 * Compose real concurrency primitives; drive them with dual ops (`Lifecycle.start(lc)`).
 * The same duals accept a wire {@link Participating} handle or Tag
 * (`Lifecycle.start(jobs)` / `Lifecycle.start(Jobs)`). Wire badge is a
 * {@link Hyperlink.ref} / Subscribable of {@link State}; transition {@link Event}s
 * are derived from badge changes (no parallel PubSub). Heavy engine:
 * `internal/lifecycle`.
 *
 * ## Spec (Subscribable badge)
 *
 * ```ts
 * class Runner extends Hyperlink.Tag<Runner>()("app/Runner", {
 *   lifecycle: Lifecycle.stateRef,           // ≡ Hyperlink.ref(State).pipe(asState)
 *   lifecycleEvents: Lifecycle.eventStream,
 *   start: Hyperlink.effect(Schema.Void).pipe(Lifecycle.asStart),
 *   stop: Hyperlink.effect(Schema.Void).pipe(Lifecycle.asStop),
 *   // domain…
 * }) {}
 * ```
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
 * yield* Lifecycle.start(Jobs)
 * const jobs = yield* Jobs
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

/** Spec Role stamp — `.pipe(Lifecycle.asState)` on a {@link Hyperlink.ref}. @category combinators @public */
export const asState = role("State");
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

/**
 * Wire Spec member — Subscribable {@link State} badge with Role `"State"`.
 *
 * Prefer this over hand-rolling `Hyperlink.ref(Lifecycle.State).pipe(Lifecycle.asState)`.
 *
 * @category constructors
 * @public
 */
export const stateRef = Hyperlink.ref(model.State)
  .annotate({
    description:
      "Lifecycle badge ({ _tag: Idle | Running | Paused | Draining | Off }).",
  })
  .pipe(asState);

/**
 * Wire Spec member — transition {@link Event} stream (derived from badge changes).
 *
 * @category constructors
 * @public
 */
export const eventStream = Hyperlink.stream(model.Event).annotate({
  description:
    "Lifecycle transition events derived from badge changes (Started / Paused / Resumed / StopRequested / Stopped).",
});

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
 * the wire `lifecycleEvents` stream on a {@link Participating} service, or a Tag
 * Effect (`Lifecycle.events(Jobs)`).
 *
 * @category observers
 * @public
 */
export function events<R>(
  self: Controllable<R>,
): Stream.Stream<model.Event>;
export function events<RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Stream.Stream<model.Event, E, R | RR>;
export function events<RR, E, R>(
  self: Controllable<RR> | Effect.Effect<Participating<RR>, E, R>,
): Stream.Stream<model.Event, E, R | RR> {
  if (Effect.isEffect(self)) {
    return Stream.unwrap(Effect.map(self, (p) => events(p)));
  }
  if (isParticipating(self)) {
    return self.lifecycleEvents ?? Stream.empty;
  }
  return engine.events(self);
}

/**
 * Start — FiberHandle.run on a Lifecycle handle, wire `start` on Participating,
 * or `Effect.flatMap(tag, start)` when given a Tag Effect
 * (`yield* Lifecycle.start(Jobs)`). Re-checks Off/Draining → {@link Illegal}.
 *
 * @category combinators
 * @public
 */
export function start<R>(
  self: Controllable<R>,
): Effect.Effect<void, model.Illegal, R>;
export function start<RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E | model.Illegal, R | RR>;
export function start<RR, E, R>(
  self: Controllable<RR> | Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E | model.Illegal, R | RR> {
  if (Effect.isEffect(self)) {
    return Effect.flatMap(self, (p) => start(p));
  }
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
}

/**
 * Pause — Latch.close on a Lifecycle handle, wire `pause` on Participating,
 * or against a Tag Effect (`yield* Lifecycle.pause(Jobs)`).
 *
 * @category combinators
 * @public
 */
export function pause<R>(
  self: Controllable<R>,
): Effect.Effect<void, model.Unsupported | model.Illegal, R>;
export function pause<RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E | model.Unsupported | model.Illegal, R | RR>;
export function pause<RR, E, R>(
  self: Controllable<RR> | Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E | model.Unsupported | model.Illegal, R | RR> {
  if (Effect.isEffect(self)) {
    return Effect.flatMap(self, (p) => pause(p));
  }
  if (isParticipating(self)) {
    return Effect.gen(function* () {
      if (self.pause === undefined) {
        return yield* new model.Unsupported({ role: "Pause" });
      }
      yield* self.pause;
    });
  }
  return engine.pause(self);
}

/**
 * Resume — Latch.open on a Lifecycle handle, wire `resume` on Participating,
 * or against a Tag Effect (`yield* Lifecycle.resume(Jobs)`).
 *
 * @category combinators
 * @public
 */
export function resume<R>(
  self: Controllable<R>,
): Effect.Effect<void, model.Unsupported | model.Illegal, R>;
export function resume<RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E | model.Unsupported | model.Illegal, R | RR>;
export function resume<RR, E, R>(
  self: Controllable<RR> | Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E | model.Unsupported | model.Illegal, R | RR> {
  if (Effect.isEffect(self)) {
    return Effect.flatMap(self, (p) => resume(p));
  }
  if (isParticipating(self)) {
    return Effect.gen(function* () {
      if (self.resume === undefined) {
        return yield* new model.Unsupported({ role: "Resume" });
      }
      yield* self.resume;
    });
  }
  return engine.resume(self);
}

/**
 * Stop — clear fibers / finalizer path on a Lifecycle handle, wire `stop` on
 * Participating, or against a Tag Effect (`yield* Lifecycle.stop(Jobs)`).
 *
 * @category combinators
 * @public
 */
export function stop<R>(
  self: Controllable<R>,
): Effect.Effect<void, never, R>;
export function stop<RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E, R | RR>;
export function stop<RR, E, R>(
  self: Controllable<RR> | Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<void, E, R | RR> {
  if (Effect.isEffect(self)) {
    return Effect.flatMap(self, (p) => stop(p));
  }
  if (isParticipating(self)) {
    return self.stop ?? Effect.die(new model.Unsupported({ role: "Stop" }));
  }
  return engine.stop(self);
}

// =============================================================================
// Spec / impl sugar
// =============================================================================

/**
 * Spec fragment for Lifecycle participation (`stateRef` + `eventStream` + verbs).
 *
 * @category constructors
 * @public
 */
export const spec = (options?: { readonly pausable?: boolean }) => {
  const pausable = options?.pausable ?? false;
  const base = {
    lifecycle: stateRef,
    lifecycleEvents: eventStream,
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
 * Impl fragment from a Lifecycle handle — spread into toolkit / {@link Hyperlink.layer}
 * impls. Wire verbs use `never` error (Illegal / Unsupported swallowed); tools that need
 * those channels use {@link start} / {@link pause} duals (they re-check the badge).
 *
 * @category constructors
 * @public
 */
export const impl = <R = never>(
  lc: LifecycleHandle<R>,
): {
  readonly lifecycle: Hyperlink.Subscribable<model.State>;
  readonly lifecycleEvents: Stream.Stream<model.Event>;
  readonly start: Effect.Effect<void, never, R>;
  readonly pause?: Effect.Effect<void, never, R>;
  readonly resume?: Effect.Effect<void, never, R>;
  readonly stop: Effect.Effect<void, never, R>;
} => ({
  lifecycle: Hyperlink.subscribable(lc.state),
  lifecycleEvents: engine.events(lc),
  start: engine.start(lc).pipe(
    Effect.catchTag("LifecycleIllegal", () => Effect.void),
  ),
  ...(lc.latch !== undefined
    ? {
        pause: engine.pause(lc).pipe(
          Effect.catchTag("LifecycleIllegal", () => Effect.void),
          Effect.catchTag("LifecycleUnsupported", () => Effect.void),
        ),
        resume: engine.resume(lc).pipe(
          Effect.catchTag("LifecycleIllegal", () => Effect.void),
          Effect.catchTag("LifecycleUnsupported", () => Effect.void),
        ),
      }
    : {}),
  stop: engine.stop(lc),
});

