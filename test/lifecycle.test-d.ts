/**
 * Type-level lock: Lifecycle State / Event / errors keep stable `_tag` so
 * `Match`, `Hyperlink.runForEachTag`, and `Effect.catchTag` stay dependable.
 * WorkPool control verb is `stop` (no `shutdown`); Participating has no shutdown alias.
 * Caps: LifecycleCore has no Latch; LifecyclePausable has latch.
 */
import type { Effect, Latch, SubscriptionRef } from "effect";
import * as Lifecycle from "../src/Lifecycle";
import type { WorkPool } from "../src/WorkPool";

type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const unsupported = new Lifecycle.Unsupported({ role: "Pause" });
const illegal = new Lifecycle.Illegal({ from: Lifecycle.off, op: "Start" });
true satisfies AssertExact<typeof unsupported._tag, "LifecycleUnsupported">;
true satisfies AssertExact<typeof illegal._tag, "LifecycleIllegal">;

declare const state: Lifecycle.State;
declare const event: Lifecycle.Event;

// Exhaustiveness: every State / Event tag is named.
type StateTags = Lifecycle.State["_tag"];
type EventTags = Lifecycle.Event["_tag"];
true satisfies AssertExact<
  StateTags,
  "Idle" | "Running" | "Paused" | "Draining" | "Off"
>;
true satisfies AssertExact<
  EventTags,
  "Started" | "Paused" | "Resumed" | "StopRequested" | "Stopped"
>;

declare const pool: WorkPool<{ readonly id: string }>;
true satisfies AssertExact<
  WorkPool<{ readonly id: string }>["stop"],
  Effect.Effect<void>
>;
// @ts-expect-error WorkPool control verb is stop — no shutdown
pool.shutdown;

declare const participating: Lifecycle.Participating;
// @ts-expect-error Participating has stop only — no shutdown alias
participating.shutdown;

declare const jobsTag: Effect.Effect<Lifecycle.Participating>;
const _startHandle: Effect.Effect<void, Lifecycle.Illegal> =
  Lifecycle.start(participating);
const _startTag: Effect.Effect<void, Lifecycle.Illegal> =
  Lifecycle.start(jobsTag);
void _startHandle;
void _startTag;

declare const core: Lifecycle.LifecycleCore;
declare const pausable: Lifecycle.LifecyclePausable;
// Structural caps: no Latch ⇒ latch is undefined; Pausable carries Latch.
true satisfies AssertExact<Lifecycle.LifecycleCore["latch"], undefined>;
true satisfies AssertExact<
  Lifecycle.LifecyclePausable["latch"],
  Latch.Latch
>;
true satisfies AssertExact<
  Lifecycle.LifecycleCore["state"],
  SubscriptionRef.SubscriptionRef<Lifecycle.State>
>;
// Fibers are real Handle | Set, not a string mode.
true satisfies AssertExact<Lifecycle.Fibers["_tag"], "Handle" | "Set">;

void unsupported;
void illegal;
void state;
void event;
void pool;
void participating;
void core;
void pausable;
