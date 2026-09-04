/**
 * Lifecycle engine — FiberHandle/Set + Latch + SubscriptionRef badge.
 * Dual ops for {@link Lifecycle} handles. Public shell: `src/Lifecycle.ts`.
 *
 * @internal
 */
import {
  Effect,
  FiberHandle,
  FiberSet,
  Filter,
  Option,
  Scope,
  Stream,
  SubscriptionRef,
  type Latch,
} from "effect";
import * as Hyperlink from "../Hyperlink";
import {
  Illegal,
  TypeId,
  Unsupported,
  draining,
  idle,
  off,
  paused,
  running,
  type Event,
  type Fibers,
  type Lifecycle,
  type LifecycleCore,
  type LifecyclePausable,
  type MakeOptions,
  type State,
  type Terminal,
} from "./lifecycleModel";

export type {
  Event,
  Fibers,
  Lifecycle,
  LifecycleCore,
  LifecyclePausable,
  MakeOptions,
  State,
  Terminal,
} from "./lifecycleModel";
export {
  Illegal,
  TypeId,
  Unsupported,
  draining,
  idle,
  off,
  paused,
  running,
} from "./lifecycleModel";

type MutableInstalled = { installed: boolean };

type FlagKey = {
  readonly [TypeId]: typeof TypeId;
};

const installedFlags = new WeakMap<FlagKey, MutableInstalled>();

const flagOf = (self: FlagKey): MutableInstalled => {
  const existing = installedFlags.get(self);
  if (existing !== undefined) return existing;
  const created: MutableInstalled = { installed: false };
  installedFlags.set(self, created);
  return created;
};

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
  if (from._tag === "Idle" && (to._tag === "Running" || to._tag === "Paused")) {
    return Option.some({ _tag: "Started" });
  }
  return Option.none();
};

/** @internal */
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

/** @internal */
export const start = <R>(
  self: Lifecycle<R>,
): Effect.Effect<void, Illegal, R> =>
  Effect.gen(function* () {
    const cur = yield* SubscriptionRef.get(self.state);
    if (cur._tag === "Running" || cur._tag === "Paused") return;
    if (cur._tag === "Draining" || cur._tag === "Off") {
      return yield* new Illegal({ from: cur, op: "Start" });
    }
    yield* installRun(self, flagOf(self));
    if (self.latch !== undefined) {
      yield* SubscriptionRef.set(
        self.state,
        self.latch.isOpen() ? running : paused,
      );
    } else {
      yield* SubscriptionRef.set(self.state, running);
    }
  });

/** @internal */
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

/** @internal */
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

/** @internal */
export const stop = <R>(
  self: Lifecycle<R>,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const cur = yield* SubscriptionRef.get(self.state);
    if (cur._tag === "Off" || cur._tag === "Draining") return;
    const flag = flagOf(self);
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

/** @internal */
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

    // Discriminate Core vs Pausable by latch presence — `latch?: Latch` is not
    // assignable to `latch: undefined | Latch` union arms without a branch.
    const self: Lifecycle<R> =
      options.latch !== undefined
        ? {
            [TypeId]: TypeId,
            fibers,
            latch: options.latch,
            state: stateRef,
            run: options.run,
            release: options.release,
            awaitBeforeTerminal: options.awaitBeforeTerminal,
            afterStop,
          }
        : {
            [TypeId]: TypeId,
            fibers,
            latch: undefined,
            state: stateRef,
            run: options.run,
            release: options.release,
            awaitBeforeTerminal: options.awaitBeforeTerminal,
            afterStop,
          };

    installedFlags.set(self, { installed: false });

    yield* Effect.addFinalizer(() =>
      stop(self).pipe(Effect.provide(context), Effect.orDie),
    );

    if (!deferred) {
      yield* start(self).pipe(
        Effect.catchTag("LifecycleIllegal", () => Effect.void),
      );
    }

    return self;
  });
}
