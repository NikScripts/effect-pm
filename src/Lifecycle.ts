/**
 * Lifecycle — Effect-native control panel over FiberHandle / FiberSet + optional Latch.
 *
 * Compose real concurrency primitives; drive them with dual ops (`Lifecycle.start(lc)`).
 * Badge is a {@link SubscriptionRef}; transition {@link Event}s are derived from
 * `state` changes (no parallel PubSub).
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
 * const lc = yield* Lifecycle.from(Jobs)
 * yield* lc.state.get
 * yield* lc.events.pipe(Hyperlink.runForEachTag({
 *   Started: () => Effect.log("up"),
 *   Stopped: (e) => Effect.log(e.to._tag),
 * }))
 * ```
 *
 * @module Lifecycle
 */
import {
  Data,
  Effect,
  FiberHandle,
  FiberSet,
  Filter,
  Option,
  Predicate,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  type Latch,
} from "effect";
import * as Hyperlink from "./Hyperlink";

const TypeId = "~hyperlink-ts/Lifecycle" as const;

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

/** Spec Role stamp — `.pipe(Lifecycle.asStart)`. Dual op is {@link start}. @category combinators @public */
export const asStart = role("Start");
/** Spec Role stamp — `.pipe(Lifecycle.asPause)`. Dual op is {@link pause}. @category combinators @public */
export const asPause = role("Pause");
/** Spec Role stamp — `.pipe(Lifecycle.asResume)`. Dual op is {@link resume}. @category combinators @public */
export const asResume = role("Resume");
/** Spec Role stamp — `.pipe(Lifecycle.asStop)`. Dual op is {@link stop}. @category combinators @public */
export const asStop = role("Stop");

/**
 * Sugar: `.pipe(Lifecycle.lifecycle("Pause"))` — prefer {@link asPause} / dual {@link pause}.
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
// Events — derived from state transitions (no PubSub SSOT)
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
 * Transition facts derived from badge changes. Match with `_tag` /
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

const eventFromTransition = (from: State, to: State): Option.Option<Event> => {
  if (from._tag === to._tag) return Option.none();
  if (to._tag === "Draining") return Option.some({ _tag: "StopRequested" });
  if (to._tag === "Off" || (to._tag === "Idle" && from._tag !== "Idle")) {
    return Option.some({ _tag: "Stopped", to });
  }
  if (to._tag === "Paused" && from._tag === "Running") {
    return Option.some({ _tag: "Paused" });
  }
  if (to._tag === "Running" && from._tag === "Paused") {
    return Option.some({ _tag: "Resumed" });
  }
  // Idle → Running | Paused (start, latch may start closed)
  if (from._tag === "Idle" && (to._tag === "Running" || to._tag === "Paused")) {
    return Option.some({ _tag: "Started" });
  }
  return Option.none();
};

// =============================================================================
// Errors — Data.TaggedError so Effect.catchTag works
// =============================================================================

/**
 * Role not supported by this service (e.g. Daemon has no Pause / no Latch).
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
 * @category errors
 * @public
 */
export class Illegal extends Data.TaggedError("LifecycleIllegal")<{
  readonly from: State;
  readonly op: Role;
}> {}

// =============================================================================
// Handle — compose FiberHandle/Set + optional Latch + SubscriptionRef
// =============================================================================

/**
 * Fiber ownership for a Lifecycle — a real {@link FiberHandle} or {@link FiberSet}.
 *
 * @category models
 * @public
 */
export type Fibers =
  | {
      readonly _tag: "Handle";
      readonly handle: FiberHandle.FiberHandle<void, never>;
    }
  | {
      readonly _tag: "Set";
      readonly set: FiberSet.FiberSet<void, never>;
    };

/**
 * Core Lifecycle handle — no Latch (no pause/resume dual).
 *
 * @category models
 * @public
 */
export interface LifecycleCore<R = never> {
  readonly [TypeId]: typeof TypeId;
  readonly fibers: Fibers;
  readonly latch: undefined;
  /** Badge SSOT — read with `SubscriptionRef.get` / `changes`. */
  readonly state: SubscriptionRef.SubscriptionRef<State>;
  readonly run: Effect.Effect<void, never, R>;
  readonly release: Effect.Effect<void, never, R> | undefined;
  readonly awaitBeforeTerminal: Effect.Effect<void, never, R> | undefined;
  readonly afterStop: Terminal;
}

/**
 * Pausable Lifecycle — Latch present ⇒ {@link pause} / {@link resume} duals.
 *
 * @category models
 * @public
 */
export interface LifecyclePausable<R = never>
  extends Omit<LifecycleCore<R>, "latch"> {
  readonly latch: Latch.Latch;
}

/**
 * {@link make} result — with or without Latch.
 *
 * @category models
 * @public
 */
export type Lifecycle<R = never> = LifecycleCore<R> | LifecyclePausable<R>;

/**
 * @category refinements
 * @public
 */
export const isLifecycle = (u: unknown): u is Lifecycle =>
  Predicate.hasProperty(u, TypeId);

/** @internal */
type MutableInstalled = { installed: boolean };

const installRun = <R>(
  self: Lifecycle<R>,
  flag: MutableInstalled,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    if (flag.installed) return;
    flag.installed = true;
    if (self.fibers._tag === "Handle") {
      yield* FiberHandle.run(self.fibers.handle, self.run);
    } else {
      yield* FiberSet.run(self.fibers.set, self.run);
    }
  });

const clearFibers = <R>(
  self: Lifecycle<R>,
  flag: MutableInstalled,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (self.fibers._tag === "Handle") {
      yield* FiberHandle.clear(self.fibers.handle);
    } else {
      yield* FiberSet.clear(self.fibers.set);
      yield* FiberSet.awaitEmpty(self.fibers.set);
    }
    flag.installed = false;
  });

/**
 * Options for {@link make}.
 *
 * @category models
 * @public
 */
export interface MakeOptions<R = never> {
  /** Effect body installed into {@link fibers} on {@link start}. */
  readonly run: Effect.Effect<void, never, R>;
  /**
   * Pause gate. When present, {@link pause} / {@link resume} close / open it.
   * Pass a real {@link Latch}; omit for non-pausable services.
   */
  readonly latch?: Latch.Latch;
  /** Wind-down before fiber clear (e.g. WorkPool drain). */
  readonly release?: Effect.Effect<void, never, R>;
  /** Optional wait after {@link release} before clearing fibers / terminal badge. */
  readonly awaitBeforeTerminal?: Effect.Effect<void, never, R>;
  /**
   * Badge after stop — {@link idle} (Daemon) or {@link off} (WorkPool).
   * Default {@link off}.
   */
  readonly afterStop?: Terminal;
  /**
   * Fiber ownership. Default: a fresh {@link FiberHandle}.
   * Pass `{ _tag: "Set", set }` for a FiberSet you already own.
   */
  readonly fibers?: Fibers;
}

/**
 * Build a Lifecycle over real Effect concurrency primitives.
 *
 * Reads ambient {@link Hyperlink.DeferStart}: when `true`, stays Idle until
 * {@link start}; otherwise runs during `make`. Scope close runs {@link stop}.
 *
 * @category constructors
 * @public
 */
export function make<R = never>(
  options: MakeOptions<R> & { readonly latch: Latch.Latch },
): Effect.Effect<LifecyclePausable<R>, never, R | Scope.Scope>;
export function make<R = never>(
  options: MakeOptions<R> & { readonly latch?: undefined },
): Effect.Effect<LifecycleCore<R>, never, R | Scope.Scope>;
export function make<R = never>(
  options: MakeOptions<R>,
): Effect.Effect<Lifecycle<R>, never, R | Scope.Scope>;
export function make<R = never>(
  options: MakeOptions<R>,
): Effect.Effect<Lifecycle<R>, never, R | Scope.Scope> {
  return Effect.gen(function* () {
    const afterStop: Terminal = options.afterStop ?? off;
    const deferred = yield* Hyperlink.DeferStart;
    const context = yield* Effect.context<R>();
    const stateRef = yield* SubscriptionRef.make<State>(idle);
    const fibers: Fibers =
      options.fibers ??
      ({
        _tag: "Handle",
        handle: yield* FiberHandle.make<void, never>(),
      } as const);
    const flag: MutableInstalled = { installed: false };

    const self = {
      [TypeId]: TypeId,
      fibers,
      latch: options.latch,
      state: stateRef,
      run: options.run,
      release: options.release,
      awaitBeforeTerminal: options.awaitBeforeTerminal,
      afterStop,
      /** @internal */
      [installedSym]: flag,
    } as Lifecycle<R> & { readonly [installedSym]: MutableInstalled };

    yield* Effect.addFinalizer(() =>
      stopImpl(self).pipe(Effect.provide(context), Effect.orDie),
    );

    if (!deferred) {
      yield* startImpl(self).pipe(
        Effect.catchTag("LifecycleIllegal", () => Effect.void),
      );
    }

    return self;
  });
}

const installedSym = Symbol.for("hyperlink-ts/Lifecycle/installed");

const installedOf = <R>(self: Lifecycle<R>): MutableInstalled =>
  (self as Lifecycle<R> & { readonly [installedSym]: MutableInstalled })[
    installedSym
  ];

const startImpl = <R>(
  self: Lifecycle<R>,
): Effect.Effect<void, Illegal, R> =>
  Effect.gen(function* () {
    const cur = yield* SubscriptionRef.get(self.state);
    if (cur._tag === "Running" || cur._tag === "Paused") return;
    if (cur._tag === "Draining" || cur._tag === "Off") {
      return yield* new Illegal({ from: cur, op: "Start" });
    }
    yield* installRun(self, installedOf(self));
    if (self.latch !== undefined) {
      yield* SubscriptionRef.set(
        self.state,
        self.latch.isOpen() ? running : paused,
      );
    } else {
      yield* SubscriptionRef.set(self.state, running);
    }
  });


const stopImpl = <R>(self: Lifecycle<R>): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const cur = yield* SubscriptionRef.get(self.state);
    if (cur._tag === "Off" || cur._tag === "Draining") return;
    const flag = installedOf(self);
    if (cur._tag === "Idle" && !flag.installed) {
      yield* SubscriptionRef.set(self.state, self.afterStop);
      return;
    }
    yield* SubscriptionRef.set(self.state, draining);
    if (self.release !== undefined) {
      yield* self.release;
    }
    if (self.awaitBeforeTerminal !== undefined) {
      yield* self.awaitBeforeTerminal;
    }
    yield* clearFibers(self, flag);
    yield* SubscriptionRef.set(self.state, self.afterStop);
  });

/**
 * Transition event stream — derived from {@link Lifecycle.state} changes (not a PubSub).
 *
 * @category observers
 * @public
 */
export const events = <R>(self: Lifecycle<R>): Stream.Stream<Event> =>
  SubscriptionRef.changes(self.state).pipe(
    Stream.zipWithPrevious,
    Stream.filterMap(
      Filter.fromPredicateOption(([prev, next]) =>
        Option.isNone(prev)
          ? Option.none()
          : eventFromTransition(prev.value, next),
      ),
    ),
  );

/**
 * Install `run` into the owned fibers (Idle → Running / Paused).
 * Spec stamp: {@link asStart}.
 *
 * @category combinators
 * @public
 */
export const start = <R>(
  self: Lifecycle<R>,
): Effect.Effect<void, Illegal, R> => startImpl(self);

/**
 * Latch.close + badge Paused. Fails {@link Unsupported} without a Latch.
 * Spec stamp: {@link asPause}.
 *
 * @category combinators
 * @public
 */
export const pause = <R>(
  self: Lifecycle<R>,
): Effect.Effect<void, Unsupported | Illegal, R> =>
  Effect.gen(function* () {
    const latch = self.latch;
    if (latch === undefined) {
      return yield* new Unsupported({ role: "Pause" });
    }
    const cur = yield* SubscriptionRef.get(self.state);
    if (cur._tag === "Paused") return;
    if (cur._tag !== "Running") {
      return yield* new Illegal({ from: cur, op: "Pause" });
    }
    yield* latch.close;
    yield* SubscriptionRef.set(self.state, paused);
  });

/**
 * Latch.open + badge Running. Fails {@link Unsupported} without a Latch.
 * Spec stamp: {@link asResume}.
 *
 * @category combinators
 * @public
 */
export const resume = <R>(
  self: Lifecycle<R>,
): Effect.Effect<void, Unsupported | Illegal, R> =>
  Effect.gen(function* () {
    const latch = self.latch;
    if (latch === undefined) {
      return yield* new Unsupported({ role: "Resume" });
    }
    const cur = yield* SubscriptionRef.get(self.state);
    if (cur._tag === "Running") return;
    if (cur._tag !== "Paused") {
      return yield* new Illegal({ from: cur, op: "Resume" });
    }
    yield* latch.open;
    yield* SubscriptionRef.set(self.state, running);
  });

/**
 * Drain → release → clear fibers → {@link Lifecycle.afterStop}.
 * Scope finalizer runs this. Spec stamp: {@link asStop}.
 *
 * @category combinators
 * @public
 */
export const stop = <R>(
  self: Lifecycle<R>,
): Effect.Effect<void, never, R> => stopImpl(self);

// =============================================================================
// Tools — Participating / of / from (wire projection)
// =============================================================================

/**
 * Tool-end handle — pause/resume always present (fail {@link Unsupported} when no Latch).
 *
 * @category models
 * @public
 */
export interface Service<R = never> {
  readonly state: Hyperlink.Subscribable<State>;
  readonly changes: Stream.Stream<State>;
  readonly events: Stream.Stream<Event>;
  readonly start: Effect.Effect<void, Illegal, R>;
  readonly pause: Effect.Effect<void, Unsupported | Illegal, R>;
  readonly resume: Effect.Effect<void, Unsupported | Illegal, R>;
  readonly stop: Effect.Effect<void, never, R>;
}

/**
 * A HyperService that participates in the Lifecycle protocol.
 *
 * @category models
 * @public
 */
export interface Participating<R = never> {
  readonly lifecycle: Hyperlink.Subscribable<State>;
  readonly lifecycleEvents?: Stream.Stream<Event>;
  readonly start: Effect.Effect<void, never, R>;
  readonly pause?: Effect.Effect<void, never, R>;
  readonly resume?: Effect.Effect<void, never, R>;
  readonly stop?: Effect.Effect<void, never, R>;
}

/**
 * Project a participating handle into {@link Service}.
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
 * Impl fragment from a {@link Lifecycle} — spread into toolkit / serve impls.
 *
 * @category constructors
 * @public
 */
export const impl = <R = never>(
  lc: Lifecycle<R>,
): {
  readonly lifecycle: Hyperlink.Subscribable<State>;
  readonly lifecycleEvents: Stream.Stream<Event>;
  readonly start: Effect.Effect<void, Illegal, R>;
  readonly pause?: Effect.Effect<void, Illegal | Unsupported, R>;
  readonly resume?: Effect.Effect<void, Illegal | Unsupported, R>;
  readonly stop: Effect.Effect<void, never, R>;
} => ({
  lifecycle: Hyperlink.subscribable(lc.state),
  lifecycleEvents: events(lc),
  start: start(lc),
  ...(lc.latch !== undefined
    ? {
        pause: pause(lc),
        resume: resume(lc),
      }
    : {}),
  stop: stop(lc),
});

/**
 * Spec-field helpers: stamp + schema for the Role `"State"` member.
 *
 * @category constructors
 * @public
 */
export const stateSchema = State;
