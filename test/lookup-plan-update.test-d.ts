/**
 * Type-level lock: Lookup.planUpdate channels.
 */
import type { Effect } from "effect";
import type * as Advice from "../src/Advice";
import type * as Dialers from "../src/Dialers";
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
  const _needsDirectory: AssertExtends<Directory.Service, Ctx> = true;
  const _needsAdvice: AssertExtends<Advice.Service, Ctx> = true;
  const _needsDialers: AssertExtends<Dialers.Service, Ctx> = true;
  const _blockedFlag: boolean = impact.blocked;
  const _lookupFirst: boolean = impact.lookupFirst;
  const _risk: {
    readonly dialerId: string;
    readonly serviceKey: string;
    readonly target: string;
  } = impact.clientsAtRisk[0]!;
  const _liveTip: {
    readonly node: string;
    readonly serviceKey: string;
    readonly schemaVersion: string | undefined;
  } = impact.liveTips[0]!;

  void _hasBlocked;
  void _hasUnknown;
  void _needsDirectory;
  void _needsAdvice;
  void _needsDialers;
  void _blockedFlag;
  void _lookupFirst;
  void _risk;
  void _liveTip;
  void tag;
}

void typeLock;
