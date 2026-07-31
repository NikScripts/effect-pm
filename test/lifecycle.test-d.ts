/**
 * Type-level lock: Lifecycle State / Event / errors keep stable `_tag` so
 * `Match`, `Hyperlink.runForEachTag`, and `Effect.catchTag` stay dependable.
 * WorkPool control verb is `stop` (no `shutdown`); Participating has no shutdown alias.
 */
import type { Effect } from "effect";
import * as Lifecycle from "../src/Lifecycle";
import type { WorkPool } from "../src/WorkPool";

type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const unsupported = new Lifecycle.Unsupported({ role: "Pause" });
const illegal = new Lifecycle.Illegal({ from: Lifecycle.off(), op: "Start" });
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

void unsupported;
void illegal;
void state;
void event;
void pool;
void participating;
