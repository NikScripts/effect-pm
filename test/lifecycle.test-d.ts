/**
 * Type-level lock: Lifecycle State / Event / errors keep stable `_tag` so
 * `Match`, `Hyperlink.runForEachTag`, and `Effect.catchTag` stay dependable.
 */
import * as Lifecycle from "../src/Lifecycle";

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

void unsupported;
void illegal;
void state;
void event;
