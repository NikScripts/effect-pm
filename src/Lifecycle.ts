/**
 * Lifecycle — Effect-shaped control panel for HyperService runtime lifetime.
 *
 * Composes {@link FiberHandle} / {@link FiberSet}, optional {@link Latch}, and a
 * {@link SubscriptionRef} badge. Not a second Scope; not a callback FSM.
 *
 * ## Implementation
 *
 * ```ts
 * const latch = yield* Latch.make(true)
 * const lc = yield* Lifecycle.make({
 *   run: workerLoop,
 *   latch,                 // ⇒ pause / resume on the type
 *   release: windDown,     // drain before interrupt
 *   restartable: false,    // stop → Off
 * })
 * ```
 *
 * ## Tools
 *
 * ```ts
 * const lc = yield* Lifecycle.from(Jobs)
 * yield* lc.state.get
 * yield* lc.start
 * yield* lc.pause.pipe(
 *   Effect.catchTag("LifecycleUnsupported", () => Effect.void),
 * )
 * ```
 *
 * Spec stamps (`Lifecycle.pause` → Role `"Pause"`) keep the wire introspectable via
 * `methodMeta`. Deferred bring-up: pipe {@link Hyperlink.deferStart} onto the layer —
 * `make` reads {@link Hyperlink.DeferStart} and stays `Idle` until `start`.
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
// Events
// =============================================================================

/**
 * Transition facts on {@link Service.events}. Separate from WorkPool item/queue events.
 * Match with `_tag` / `Effect.catchTag` is N/A (stream elements, not errors).
 *
 * @category models
 * @public
 */
export type Event =
  | { readonly _tag: "Started" }
  | { readonly _tag: "Paused" }
  | { readonly _tag: "Resumed" }
  | { readonly _tag: "StopRequested" }
  | { readonly _tag: "Stopped"; readonly to: "Off" | "Idle" };

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
  readonly role: "Pause" | "Resume" | "Start" | "Stop";
}> {}

/**
 * Illegal transition for the current {@link State} (e.g. `start` while `Off`).
 *
 * @example
 * lc.start.pipe(
 *   Effect.catchTag("LifecycleIllegal", (e) => Effect.log(`${e.op} from ${e.from}`)),
 * )
 *
 * @category errors
 * @public
 */
export class Illegal extends Data.TaggedError("LifecycleIllegal")<{
  readonly from: State;
  readonly op: "Start" | "Pause" | "Resume" | "Stop";
}> {}

// =============================================================================
// Service
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
  /** Badge stream — same as `state.changes`. */
  readonly changes: Stream.Stream<State>;
  /** Transition events (`_tag`: Started / Paused / …). */
  readonly events: Stream.Stream<Event>;
  /**
   * Idle → Running (or Paused if latch starts closed). Idempotent when already Running/Paused.
   * Fails {@link Illegal} from Draining/Off.
   */
  readonly start: Effect.Effect<void, Illegal, R>;
  /** Running → Paused. Fails {@link Unsupported} when no Latch; {@link Illegal} from other states. */
  readonly pause: Effect.Effect<void, Unsupported | Illegal, R>;
  /** Paused → Running. Fails {@link Unsupported} when no Latch; {@link Illegal} from other states. */
  readonly resume: Effect.Effect<void, Unsupported | Illegal, R>;
  /** → Draining → `release` → clear fibers → Off or Idle (`restartable`). Idempotent. */
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
  /** Preferred stop verb. */
  readonly stop?: Effect.Effect<void, never, R>;
  /** WorkPool alias for stop (transitional until rename lands). */
  readonly shutdown?: Effect.Effect<void, never, R>;
}

/**
 * Project a participating handle into {@link Service} — the **tool / co-located** end.
 *
 * @category constructors
 * @public
 */
export const of = <R = never>(svc: Participating<R>): Service<R> => {
  const stopFx =
    svc.stop ??
    svc.shutdown ??
    Effect.die(new Unsupported({ role: "Stop" }));
  return {
    state: svc.lifecycle,
    changes: svc.lifecycle.changes,
    events: Stream.empty,
    start: Effect.mapError(
      svc.start,
      (_: never) => new Illegal({ from: "Idle", op: "Start" }),
    ),
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
 *
 * @category constructors
 * @public
 */
export const from = <RR, E, R>(
  tag: Effect.Effect<Participating<RR>, E, R>,
): Effect.Effect<Service<RR>, E, R> => Effect.map(tag, of);

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
   * When omitted, those methods fail {@link Unsupported} (`_tag: "LifecycleUnsupported"`).
   */
  readonly latch?: Latch.Latch;
  /**
   * Wind-down before fiber clear (e.g. WorkPool drain). Awaited during {@link Service.stop}.
   */
  readonly release?: Effect.Effect<void, never, R>;
  /**
   * After stop: `true` → `Idle` (restartable, Daemon); `false` → `Off` (WorkPool). Default `false`.
   */
  readonly restartable?: boolean;
  /**
   * `"handle"` (default) — one supervisor fiber via {@link FiberHandle}.
   * `"set"` — install `run` once into a {@link FiberSet}.
   */
  readonly fiber?: "handle" | "set";
}

/**
 * Build a {@link Service} from Effect concurrency primitives.
 *
 * Reads ambient {@link Hyperlink.DeferStart}: when `true`, stays `Idle` until {@link Service.start};
 * otherwise runs `run` during `make`. Scope close runs {@link Service.stop}.
 *
 * @category constructors
 * @public
 */
export const make = <R = never>(
  options: MakeOptions<R>,
): Effect.Effect<Service<R>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const restartable = options.restartable ?? false;
    const afterStop: "Off" | "Idle" = restartable ? "Idle" : "Off";
    const fiberMode = options.fiber ?? "handle";
    const deferred = yield* Hyperlink.DeferStart;
    const context = yield* Effect.context<R>();

    const stateRef = yield* SubscriptionRef.make<State>("Idle");
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
      if (cur === "Running" || cur === "Paused") return;
      if (cur === "Draining" || cur === "Off") {
        return yield* new Illegal({ from: cur, op: "Start" });
      }
      yield* installRun;
      if (options.latch !== undefined) {
        yield* setState(options.latch.isOpen() ? "Running" : "Paused");
      } else {
        yield* setState("Running");
      }
      yield* publish({ _tag: "Started" });
    });

    const gate = options.latch;
    const pauseFx: Effect.Effect<void, Unsupported | Illegal, R> =
      gate === undefined
        ? Effect.fail(new Unsupported({ role: "Pause" }))
        : Effect.gen(function* () {
            const cur = yield* SubscriptionRef.get(stateRef);
            if (cur === "Paused") return;
            if (cur !== "Running") {
              return yield* new Illegal({ from: cur, op: "Pause" });
            }
            yield* gate.close;
            yield* setState("Paused");
            yield* publish({ _tag: "Paused" });
          });

    const resumeFx: Effect.Effect<void, Unsupported | Illegal, R> =
      gate === undefined
        ? Effect.fail(new Unsupported({ role: "Resume" }))
        : Effect.gen(function* () {
            const cur = yield* SubscriptionRef.get(stateRef);
            if (cur === "Running") return;
            if (cur !== "Paused") {
              return yield* new Illegal({ from: cur, op: "Resume" });
            }
            yield* gate.open;
            yield* setState("Running");
            yield* publish({ _tag: "Resumed" });
          });

    const stopFx: Effect.Effect<void, never, R> = Effect.gen(function* () {
      const cur = yield* SubscriptionRef.get(stateRef);
      if (cur === "Off" || cur === "Draining") return;
      if (cur === "Idle" && !installed) {
        yield* setState(afterStop);
        yield* publish({ _tag: "Stopped", to: afterStop });
        return;
      }
      yield* setState("Draining");
      yield* publish({ _tag: "StopRequested" });
      if (options.release !== undefined) {
        yield* options.release;
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

    return {
      state: stateSub,
      changes: stateSub.changes,
      events: Stream.unwrap(
        PubSub.subscribe(eventsHub).pipe(
          Effect.map((sub) => Stream.fromSubscription(sub)),
        ),
      ),
      start: startFx,
      pause: pauseFx,
      resume: resumeFx,
      stop: stopFx,
    } satisfies Service<R>;
  });

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
        description: "Lifecycle badge (Idle / Running / Paused / Draining / Off).",
      })
      .pipe(state),
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
  lc: Service<R>,
): {
  readonly lifecycle: Hyperlink.Subscribable<State>;
  readonly start: Effect.Effect<void, Illegal, R>;
  readonly pause: Effect.Effect<void, Unsupported | Illegal, R>;
  readonly resume: Effect.Effect<void, Unsupported | Illegal, R>;
  readonly stop: Effect.Effect<void, never, R>;
} => ({
  lifecycle: lc.state,
  start: lc.start,
  pause: lc.pause,
  resume: lc.resume,
  stop: lc.stop,
});

/**
 * Spec-field helpers: stamp + schema for the Role `"State"` member.
 *
 * @category constructors
 * @public
 */
export const stateSchema = State;
