/**
 * Lifecycle — first-class lifecycle **service** any HyperService can adopt, plus Spec stamps
 * so tools discover the same surface over the wire.
 *
 * ## Two ends, one Service
 *
 * **Implementation** — build a {@link Service} with {@link make} (state machine + hooks), then
 * wire its members onto your Spec:
 *
 * ```ts
 * const lifecycle = yield* Lifecycle.make({
 *   initial: "Idle",
 *   onStart: forkWorkers,
 *   onPause: latch.close,
 *   onResume: latch.open,
 *   onStop: beginShutdown,
 *   afterStop: "Off",
 * })
 * // Spec impl
 * ({
 *   lifecycle: lifecycle.state,
 *   start: lifecycle.start,
 *   pause: lifecycle.pause,
 *   resume: lifecycle.resume,
 *   shutdown: lifecycle.stop,
 * })
 * ```
 *
 * **Tools / co-located code** — project any participating handle with {@link of} /
 * {@link from}:
 *
 * ```ts
 * const lc = yield* Lifecycle.from(Jobs) // or Lifecycle.of(yield* Jobs)
 * yield* lc.state.get                     // "Idle" | "Running" | …
 * yield* lc.start
 * yield* lc.pause
 * ```
 *
 * Spec stamps (`Lifecycle.pause` → Role `"Pause"`) keep the wire introspectable via
 * `methodMeta` for generic UIs that don't hold a typed handle.
 *
 * Deferred bring-up: pipe {@link Hyperlink.deferStart} onto the HyperService layer, then
 * {@link make} with `initial: "Idle"`.
 *
 * @module Lifecycle
 */
import { Data, Effect, Schema, SubscriptionRef } from "effect";
import type * as Hyperlink from "./Hyperlink";

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

/** Mark the reactive {@link State} field (`lifecycle` / equivalent). @category combinators @public */
export const state = role("State");

/** Mark the start command. @category combinators @public */
export const start = role("Start");

/** Mark the pause command. @category combinators @public */
export const pause = role("Pause");

/** Mark the resume command. @category combinators @public */
export const resume = role("Resume");

/** Mark the stop / shutdown command. @category combinators @public */
export const stop = role("Stop");

/**
 * Sugar: `.pipe(Lifecycle.lifecycle("Pause"))` — prefer the named combinators above.
 *
 * @category combinators
 * @public
 */
export const lifecycle = <R extends Role>(lifecycleRole: R) => role(lifecycleRole);

// =============================================================================
// State (wire vocabulary)
// =============================================================================

/**
 * Shared lifecycle badge. Success schema of a Role `"State"` field; element of
 * {@link Service.state}.
 *
 * @category models
 * @public
 */
export type State = "Idle" | "Running" | "Paused" | "Draining" | "Off";

/**
 * Wire schema for {@link State}.
 *
 * @category schemas
 * @public
 */
export const State = Schema.Literals([
  "Idle",
  "Running",
  "Paused",
  "Draining",
  "Off",
]);

// =============================================================================
// Service (first-class handle — impl + tools)
// =============================================================================

/**
 * First-class lifecycle handle — what {@link make} builds and what {@link of} / {@link from}
 * project from a participating HyperService.
 *
 * @typeParam R - requirements on the command Effects (engine / worker context)
 *
 * @category models
 * @public
 */
export interface Service<R = never> {
  /** Live badge (`get` + `changes`). */
  readonly state: Hyperlink.Subscribable<State>;
  /** Idle → Running (idempotent when already Running). */
  readonly start: Effect.Effect<void, never, R>;
  /** Running → Paused. Fails {@link Unsupported} when the service has no pause. */
  readonly pause: Effect.Effect<void, Unsupported, R>;
  /** Paused → Running. Fails {@link Unsupported} when the service has no resume. */
  readonly resume: Effect.Effect<void, Unsupported, R>;
  /** → Draining → {@link MakeOptions.afterStop} (`Off` or restartable `Idle`). */
  readonly stop: Effect.Effect<void, never, R>;
}

/**
 * A HyperService (or handle) that participates in the Lifecycle protocol — enough surface
 * for {@link of} to build a {@link Service}.
 *
 * @category models
 * @public
 */
export interface Participating<R = never> {
  readonly lifecycle: Hyperlink.Subscribable<State>;
  readonly start: Effect.Effect<void, never, R>;
  readonly pause?: Effect.Effect<void, never, R>;
  readonly resume?: Effect.Effect<void, never, R>;
  /** Preferred stop verb (Daemon). */
  readonly stop?: Effect.Effect<void, never, R>;
  /** WorkPool alias for stop. */
  readonly shutdown?: Effect.Effect<void, never, R>;
}

/**
 * Role not supported by this service (e.g. Daemon has no Pause).
 *
 * @category errors
 * @public
 */
export class Unsupported extends Data.TaggedError("LifecycleUnsupported")<{
  readonly role: "Pause" | "Resume" | "Start" | "Stop";
}> {}

/**
 * Project a participating handle into {@link Service} — the **tool / co-located** end.
 *
 * ```ts
 * const jobs = yield* Jobs
 * const lc = Lifecycle.of(jobs)
 * yield* lc.state.get
 * yield* lc.start
 * ```
 *
 * @category constructors
 * @public
 */
export const of = <R = never>(svc: Participating<R>): Service<R> => ({
  state: svc.lifecycle,
  start: svc.start,
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
  stop:
    svc.stop ??
    svc.shutdown ??
    Effect.die(new Unsupported({ role: "Stop" })),
});

/**
 * `Effect.map(tag, of)` — `yield* Lifecycle.from(Jobs)`.
 *
 * @category constructors
 * @public
 */
export const from = <RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<Service<RR>, E, R> => Effect.map(tag, of);

// =============================================================================
// make — implementation end
// =============================================================================

/**
 * Hooks + policy for {@link make}.
 *
 * @category models
 * @public
 */
export interface MakeOptions<R = never> {
  /** Starting badge. Default `"Running"` (and {@link onStart} runs during make). */
  readonly initial?: State;
  /** Fork / arm the engine. Invoked by {@link Service.start} and when `initial` is `"Running"`. */
  readonly onStart: Effect.Effect<void, never, R>;
  /** Optional soft hold. Omit ⇒ {@link Service.pause} fails {@link Unsupported}. */
  readonly onPause?: Effect.Effect<void, never, R>;
  /** Optional resume. Omit ⇒ {@link Service.resume} fails {@link Unsupported}. */
  readonly onResume?: Effect.Effect<void, never, R>;
  /** Wind down. Invoked by {@link Service.stop}. */
  readonly onStop: Effect.Effect<void, never, R>;
  /**
   * Badge after stop completes. `"Off"` = terminal (WorkPool); `"Idle"` = restartable (Daemon).
   * Default `"Off"`.
   */
  readonly afterStop?: "Off" | "Idle";
}

/**
 * Build a {@link Service} — the **implementation** end. Owns the {@link State} machine;
 * your engine supplies hooks.
 *
 * ```ts
 * const lifecycle = yield* Lifecycle.make({
 *   initial: defer ? "Idle" : "Running",
 *   onStart: forkDriver,
 *   onStop: interruptDriver,
 *   afterStop: "Idle",
 * })
 * ```
 *
 * @category constructors
 * @public
 */
export const make = <R = never>(
  options: MakeOptions<R>,
): Effect.Effect<Service<R>, never, R> =>
  Effect.gen(function* () {
    const initial = options.initial ?? "Running";
    const afterStop = options.afterStop ?? "Off";
    const stateRef = yield* SubscriptionRef.make<State>(
      initial === "Running" ? "Idle" : initial,
    );

    const setState = (next: State) => SubscriptionRef.set(stateRef, next);

    const start: Effect.Effect<void, never, R> = Effect.gen(function* () {
      const cur = yield* SubscriptionRef.get(stateRef);
      if (cur === "Running" || cur === "Paused" || cur === "Draining") return;
      if (cur === "Off") return;
      yield* options.onStart;
      yield* setState("Running");
    });

    const pause: Effect.Effect<void, Unsupported, R> = Effect.gen(function* () {
      if (options.onPause === undefined) {
        return yield* new Unsupported({ role: "Pause" });
      }
      const cur = yield* SubscriptionRef.get(stateRef);
      if (cur !== "Running") return;
      yield* options.onPause;
      yield* setState("Paused");
    });

    const resume: Effect.Effect<void, Unsupported, R> = Effect.gen(function* () {
      if (options.onResume === undefined) {
        return yield* new Unsupported({ role: "Resume" });
      }
      const cur = yield* SubscriptionRef.get(stateRef);
      if (cur !== "Paused") return;
      yield* options.onResume;
      yield* setState("Running");
    });

    const stop: Effect.Effect<void, never, R> = Effect.gen(function* () {
      const cur = yield* SubscriptionRef.get(stateRef);
      if (cur === "Off" || cur === "Draining") return;
      yield* setState("Draining");
      yield* options.onStop;
      yield* setState(afterStop);
    });

    if (initial === "Running") {
      yield* start;
    }

    const state: Hyperlink.Subscribable<State> = {
      get: SubscriptionRef.get(stateRef),
      changes: SubscriptionRef.changes(stateRef),
    };

    return { state, start, pause, resume, stop } satisfies Service<R>;
  });

/**
 * Spec-field helpers: stamp + schema for the Role `"State"` member.
 * Prefer wiring `lifecycle: lifecycle.state` from {@link make} / {@link of}.
 *
 * @category constructors
 * @public
 */
export const stateSchema = State;
