/**
 * Type-level lock: Lifecycle tagged errors / events keep stable `_tag` so
 * `Effect.catchTag` and stream matches stay dependable.
 */
import * as Lifecycle from "../src/Lifecycle";

type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const unsupported = new Lifecycle.Unsupported({ role: "Pause" });
const illegal = new Lifecycle.Illegal({ from: "Off", op: "Start" });

true satisfies AssertExact<typeof unsupported._tag, "LifecycleUnsupported">;
true satisfies AssertExact<typeof illegal._tag, "LifecycleIllegal">;
true satisfies AssertExact<typeof unsupported.role, "Pause" | "Resume" | "Start" | "Stop">;
true satisfies AssertExact<typeof illegal.from, Lifecycle.State>;
true satisfies AssertExact<typeof illegal.op, "Start" | "Pause" | "Resume" | "Stop">;

const started: Lifecycle.Event = { _tag: "Started" };
const paused: Lifecycle.Event = { _tag: "Paused" };
const resumed: Lifecycle.Event = { _tag: "Resumed" };
const stopRequested: Lifecycle.Event = { _tag: "StopRequested" };
const stopped: Lifecycle.Event = { _tag: "Stopped", to: "Idle" };

true satisfies AssertExact<typeof started._tag, "Started">;
true satisfies AssertExact<typeof paused._tag, "Paused">;
true satisfies AssertExact<typeof resumed._tag, "Resumed">;
true satisfies AssertExact<typeof stopRequested._tag, "StopRequested">;
true satisfies AssertExact<typeof stopped._tag, "Stopped">;
true satisfies AssertExact<typeof stopped.to, "Off" | "Idle">;

void unsupported;
void illegal;
void started;
void paused;
void resumed;
void stopRequested;
void stopped;
