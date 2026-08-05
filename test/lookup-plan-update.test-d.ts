/**
 * Type-level lock: Lookup.planUpdate channels.
 */
import type { Effect } from "effect";
import type * as Advice from "../src/Advice";
import type * as Directory from "../src/Directory";
import type * as Lookup from "../src/Lookup";

type ErrOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;
type CtxOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
type AssertExtends<A, B> = [A] extends [B] ? true : false;

function typeLock(
  planUpdate: typeof Lookup.planUpdate,
  tag: Lookup.PlanUpdateTag,
  impact: Lookup.UpdateImpact,
): void {
  type Plan = ReturnType<typeof planUpdate>;
  type Errs = ErrOf<Plan>;
  type Ctx = CtxOf<Plan>;

  const _hasBlocked: AssertExtends<Lookup.UpdateBlocked, Errs> = true;
  const _hasUnknown: AssertExtends<Lookup.UpdateTargetUnknown, Errs> = true;
  const _needsDirectory: AssertExtends<Directory.Tag, Ctx> = true;
  const _needsAdvice: AssertExtends<Advice.Tag, Ctx> = true;
  const _blockedFlag: boolean = impact.blocked;
  const _lookupFirst: boolean = impact.lookupFirst;

  void _hasBlocked;
  void _hasUnknown;
  void _needsDirectory;
  void _needsAdvice;
  void _blockedFlag;
  void _lookupFirst;
  void tag;
}

void typeLock;
