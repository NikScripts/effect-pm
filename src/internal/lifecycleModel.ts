/**
 * Lifecycle shared model — TypeId, State/Event schemas, handle types, errors.
 * Imported by the public `Lifecycle` shell and by `internal/lifecycle` (no cycle).
 *
 * @internal
 */
import {
  Data,
  FiberHandle,
  FiberSet,
  Predicate,
  Schema,
  SubscriptionRef,
  type Effect,
  type Latch,
} from "effect";

/** @internal */
export const TypeId = "~hyperlink-ts/Lifecycle" as const;

/** @internal */
export type LifecycleRole = "State" | "Start" | "Pause" | "Resume" | "Stop";

/** @internal */
export const Idle = Schema.TaggedStruct("Idle", {});
/** @internal */
export const Running = Schema.TaggedStruct("Running", {});
/** @internal */
export const Paused = Schema.TaggedStruct("Paused", {});
/** @internal */
export const Draining = Schema.TaggedStruct("Draining", {});
/** @internal */
export const Off = Schema.TaggedStruct("Off", {});

/** @internal */
export const State = Schema.Union([Idle, Running, Paused, Draining, Off]);
export type State = typeof State.Type;

/** @internal */
export const idle: typeof Idle.Type = { _tag: "Idle" };
/** @internal */
export const running: typeof Running.Type = { _tag: "Running" };
/** @internal */
export const paused: typeof Paused.Type = { _tag: "Paused" };
/** @internal */
export const draining: typeof Draining.Type = { _tag: "Draining" };
/** @internal */
export const off: typeof Off.Type = { _tag: "Off" };

/** @internal */
export type Terminal = typeof Idle.Type | typeof Off.Type;

/** @internal */
export const Started = Schema.TaggedStruct("Started", {});
/** @internal */
export const EventPaused = Schema.TaggedStruct("Paused", {});
/** @internal */
export const Resumed = Schema.TaggedStruct("Resumed", {});
/** @internal */
export const StopRequested = Schema.TaggedStruct("StopRequested", {});
/** @internal */
export const Stopped = Schema.TaggedStruct("Stopped", {
  to: Schema.Union([Idle, Off]),
});

/** @internal */
export const Event = Schema.Union([
  Started,
  EventPaused,
  Resumed,
  StopRequested,
  Stopped,
]);
export type Event = typeof Event.Type;

/** @internal */
export class Unsupported extends Data.TaggedError("LifecycleUnsupported")<{
  readonly role: LifecycleRole;
}> {}

/** @internal */
export class Illegal extends Data.TaggedError("LifecycleIllegal")<{
  readonly from: State;
  readonly op: LifecycleRole;
}> {}

/** @internal */
export type Fibers =
  | {
      readonly _tag: "Handle";
      readonly handle: FiberHandle.FiberHandle<void, never>;
    }
  | {
      readonly _tag: "Set";
      readonly set: FiberSet.FiberSet<void, never>;
    };

/** @internal */
export interface LifecycleCore<R = never> {
  readonly [TypeId]: typeof TypeId;
  readonly fibers: Fibers;
  readonly latch: undefined;
  readonly state: SubscriptionRef.SubscriptionRef<State>;
  readonly run: Effect.Effect<void, never, R>;
  readonly release: Effect.Effect<void, never, R> | undefined;
  readonly awaitBeforeTerminal: Effect.Effect<void, never, R> | undefined;
  readonly afterStop: Terminal;
}

/** @internal */
export interface LifecyclePausable<R = never>
  extends Omit<LifecycleCore<R>, "latch"> {
  readonly latch: Latch.Latch;
}

/** @internal */
export type Lifecycle<R = never> = LifecycleCore<R> | LifecyclePausable<R>;

/** @internal */
export const isLifecycle = <R = never>(u: unknown): u is Lifecycle<R> =>
  Predicate.hasProperty(u, TypeId);

/** @internal */
export interface MakeOptions<R = never> {
  readonly run: Effect.Effect<void, never, R>;
  readonly latch?: Latch.Latch;
  readonly release?: Effect.Effect<void, never, R>;
  readonly awaitBeforeTerminal?: Effect.Effect<void, never, R>;
  readonly afterStop?: Terminal;
  readonly fibers?: Fibers;
}
