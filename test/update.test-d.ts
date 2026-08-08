/**
 * Type-level lock: Update.plan / simulate / execute channels + plan shape.
 */
import type { Effect } from "effect";
import type * as Advice from "../src/Advice";
import type * as Dialers from "../src/Dialers";
import type * as Directory from "../src/Directory";
import type {
  AuditEntry,
  AuditReason,
  Input,
  Plan,
  Report,
  Step,
} from "../src/Update";
import type * as Update from "../src/Update";
import type * as Launcher from "../src/Launcher";

type ErrOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;
type CtxOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
type OkOf<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;
type AssertExtends<A, B> = [A] extends [B] ? true : false;

function typeLock(
  planFn: typeof Update.plan,
  simulateFn: typeof Update.simulate,
  executeFn: typeof Update.execute,
  isPlanFn: typeof Update.isPlan,
  restartFn: typeof Launcher.restartSuccessor,
  planValue: Plan,
  step: Step,
  input: Input,
  audit: AuditEntry,
  report: Report,
  reason: AuditReason,
  mismatch: Update.UpdateContractMismatch,
): void {
  type PlanEff = ReturnType<typeof planFn>;
  type SimEff = ReturnType<typeof simulateFn>;
  type ExecEff = ReturnType<typeof executeFn>;
  type RestartEff = ReturnType<typeof restartFn>;

  const _planOk: AssertExtends<Plan, OkOf<PlanEff>> = true;
  const _hasEmpty: AssertExtends<Update.EmptyPlan, ErrOf<PlanEff>> = true;
  const _hasEmptyTags: AssertExtends<Update.EmptyStepTags, ErrOf<PlanEff>> =
    true;
  const _hasDup: AssertExtends<Update.DuplicateTarget, ErrOf<PlanEff>> = true;
  const _hasContract: AssertExtends<
    Update.UpdateContractMismatch,
    ErrOf<PlanEff>
  > = true;
  const _hasBlocked: AssertExtends<Update.UpdateBlocked, ErrOf<PlanEff>> = true;
  const _hasUnknown: AssertExtends<Update.UpdateTargetUnknown, ErrOf<PlanEff>> =
    true;
  const _needsDirectory: AssertExtends<Directory.Service, CtxOf<PlanEff>> =
    true;
  const _needsAdvice: AssertExtends<Advice.Service, CtxOf<PlanEff>> = true;
  const _needsDialers: AssertExtends<Dialers.Service, CtxOf<PlanEff>> = true;

  const _simOk: AssertExtends<Report, OkOf<SimEff>> = true;
  const _simBlocked: AssertExtends<Update.PlanBlocked, ErrOf<SimEff>> = true;
  const _simContract: AssertExtends<
    Update.UpdateContractMismatch,
    ErrOf<SimEff>
  > = true;

  const _execBlocked: AssertExtends<Update.PlanBlocked, ErrOf<ExecEff>> = true;
  const _execContract: AssertExtends<
    Update.UpdateContractMismatch,
    ErrOf<ExecEff>
  > = true;
  const _execCoversRestart: AssertExtends<
    ErrOf<RestartEff>,
    ErrOf<ExecEff>
  > = true;

  const _tag: "UpdatePlan" = planValue._tag;
  const _order: number = planValue.steps[0]!.order;
  const _blocked: boolean = planValue.blocked;
  const _coUpdate: ReadonlyArray<string> = planValue.coUpdate;
  const _uncovered: ReadonlyArray<string> = planValue.uncoveredCoUpdate;
  const _target: string = step.target;
  const _steps: ReadonlyArray<Step> = input.steps;
  const _auditOk: boolean = audit.ok;
  const _reportAudit: ReadonlyArray<AuditEntry> = report.audit;
  const _isPlan: boolean = isPlanFn(planValue);
  const _reason: AuditReason = reason;
  const _mismatchAudit: ReadonlyArray<AuditEntry> = mismatch.audit;
  const _mismatchReason: AuditReason = mismatch.reason;
  const _liveTips: ReadonlyArray<{
    readonly node: string;
    readonly serviceKey: string;
    readonly schemaVersion: string | undefined;
  }> = planValue.steps[0]!.impact?.liveTips ?? [];

  void _planOk;
  void _hasEmpty;
  void _hasEmptyTags;
  void _hasDup;
  void _hasContract;
  void _hasBlocked;
  void _hasUnknown;
  void _needsDirectory;
  void _needsAdvice;
  void _needsDialers;
  void _simOk;
  void _simBlocked;
  void _simContract;
  void _execBlocked;
  void _execContract;
  void _execCoversRestart;
  void _tag;
  void _order;
  void _blocked;
  void _coUpdate;
  void _uncovered;
  void _target;
  void _steps;
  void _auditOk;
  void _reportAudit;
  void _isPlan;
  void _reason;
  void _mismatchAudit;
  void _mismatchReason;
  void _liveTips;
}

void typeLock;
