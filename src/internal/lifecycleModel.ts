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

export const TypeId = "~hyperlink-ts/Lifecycle" as const;

/** @internal */
export type LifecycleRole = "State" | "Start" | "Pause" | "Resume" | "Stop";

export const Idle = Schema.TaggedStruct("Idle", {});
export const Running = Schema.TaggedStruct("Running", {});
export const Paused = Schema.TaggedStruct("Paused", {});
export const Draining = Schema.TaggedStruct("Draining", {});
export const Off = Schema.TaggedStruct("Off", {});

export const State = Schema.Union([Idle, Running, Paused, Draining, Off]);
export type State = typeof State.Type;

export const idle: typeof Idle.Type = { _tag: "Idle" };
export const running: typeof Running.Type = { _tag: "Running" };
export const paused: typeof Paused.Type = { _tag: "Paused" };
export const draining: typeof Draining.Type = { _tag: "Draining" };
export const off: typeof Off.Type = { _tag: "Off" };

export type Terminal = typeof Idle.Type | typeof Off.Type;

export const Started = Schema.TaggedStruct("Started", {});
export const EventPaused = Schema.TaggedStruct("Paused", {});
export const Resumed = Schema.TaggedStruct("Resumed", {});
export const StopRequested = Schema.TaggedStruct("StopRequested", {});
export const Stopped = Schema.TaggedStruct("Stopped", {
  to: Schema.Union([Idle, Off]),
});

export const Event = Schema.Union([
  Started,
  EventPaused,
  Resumed,
  StopRequested,
  Stopped,
]);
export type Event = typeof Event.Type;

export class Unsupported extends Data.TaggedError("LifecycleUnsupported")<{
  readonly role: LifecycleRole;
}> {}

export class Illegal extends Data.TaggedError("LifecycleIllegal")<{
  readonly from: State;
  readonly op: LifecycleRole;
}> {}

export type Fibers =
  | {
      readonly _tag: "Handle";
      readonly handle: FiberHandle.FiberHandle<void, never>;
    }
  | {
      readonly _tag: "Set";
      readonly set: FiberSet.FiberSet<void, never>;
    };

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

export interface LifecyclePausable<R = never>
  extends Omit<LifecycleCore<R>, "latch"> {
  readonly latch: Latch.Latch;
}

export type Lifecycle<R = never> = LifecycleCore<R> | LifecyclePausable<R>;

export const isLifecycle = <R = never>(u: unknown): u is Lifecycle<R> =>
  Predicate.hasProperty(u, TypeId);

export interface MakeOptions<R = never> {
  readonly run: Effect.Effect<void, never, R>;
  readonly latch?: Latch.Latch;
  readonly release?: Effect.Effect<void, never, R>;
  readonly awaitBeforeTerminal?: Effect.Effect<void, never, R>;
  readonly afterStop?: Terminal;
  readonly fibers?: Fibers;
}
