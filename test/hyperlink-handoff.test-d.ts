/**
 * Type-level lock: Locked #39 handoff outcomes + `HandoffDeferred` reasons stay PascalCase
 * discriminants (match via `_tag` / `.reason`, never message strings).
 */
import { HandoffDeferred } from "../src/Hyperlink";
import type { HandoffDeferralReason, HandoffOutcome } from "../src/Hyperlink";

type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

true satisfies AssertExact<HandoffOutcome["_tag"], "Done" | "Retry" | "Defer">;
true satisfies AssertExact<
  HandoffDeferralReason,
  "Defer" | "NoPeer" | "RetryExhausted" | "Failed"
>;

const deferred = new HandoffDeferred({
  serviceKey: "ab/Jobs",
  reason: "NoPeer",
});
true satisfies AssertExact<typeof deferred._tag, "HandoffDeferred">;
true satisfies AssertExact<typeof deferred.reason, HandoffDeferralReason>;
void (deferred.serviceKey satisfies string);

new HandoffDeferred({ serviceKey: "x", reason: "Defer" });
new HandoffDeferred({ serviceKey: "x", reason: "RetryExhausted" });
new HandoffDeferred({ serviceKey: "x", reason: "Failed" });
new HandoffDeferred({
  serviceKey: "x",
  reason: "NoPeer",
  node: "ab/WorkerA",
});

// @ts-expect-error - kebab / lowercase reason strings are not in the public union
new HandoffDeferred({ serviceKey: "x", reason: "no-peer" });

// @ts-expect-error - serviceKey is required
new HandoffDeferred({ reason: "Defer" });
