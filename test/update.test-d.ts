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
  ExecuteError,
  Input,
  Plan,
  PlanError,
  Report,
  Step,
  ValidateError,
} from "../src/Update";
import type * as Update from "../src/Update";
import type * as Launcher from "../src/Launcher";

type ErrOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;
type CtxOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
type OkOf<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;
type AssertExtends<A, B> = [A] extends [B] ? true : false;
type AssertEquals<A, B> =
  AssertExtends<A, B> extends true
    ? AssertExtends<B, A> extends true
      ? true
      : false
    : false;

function typeLock(
  planFn: typeof Update.plan,
  simulateFn: typeof Update.simulate,
  executeFn: typeof Update.execute,
  isPlanFn: typeof Update.isPlan,
  isReportFn: typeof Update.isReport,
  restartFn: typeof Launcher.restartSuccessor,
  planValue: Plan,
  step: Step,
  input: Input,
  audit: AuditEntry,
  report: Report,
  reason: AuditReason,
  mismatch: Update.UpdateContractMismatch,
  planError: PlanError,
  validateError: ValidateError,
  executeError: ExecuteError,
): void {
  type PlanEff = ReturnType<typeof planFn>;
  type SimEff = ReturnType<typeof simulateFn>;
  type ExecEff = ReturnType<typeof executeFn>;
  type RestartEff = ReturnType<typeof restartFn>;

  const _planOk: AssertExtends<Plan, OkOf<PlanEff>> = true;
  const _hasEmpty: AssertExtends<Update.EmptyPlan, ErrOf<PlanEff>> = true;
  const _hasEmptyTags: AssertExtends<Update.EmptyStepTags, ErrOf<PlanEff>> =
    true;
  const _hasEmptyTarget: AssertExtends<Update.EmptyTarget, ErrOf<PlanEff>> =
    true;
  const _hasEmptyKey: AssertExtends<Update.EmptyTagKey, ErrOf<PlanEff>> = true;
  const _hasDup: AssertExtends<Update.DuplicateTarget, ErrOf<PlanEff>> = true;
  const _hasDupContract: AssertExtends<
    Update.DuplicateContract,
    ErrOf<PlanEff>
  > = true;
  const _hasContract: AssertExtends<
    Update.UpdateContractMismatch,
    ErrOf<PlanEff>
  > = true;
  const _hasBlocked: AssertExtends<Update.UpdateBlocked, ErrOf<PlanEff>> = true;
  const _hasUnknown: AssertExtends<Update.UpdateTargetUnknown, ErrOf<PlanEff>> =
    true;
  const _planError: AssertExtends<ErrOf<PlanEff>, PlanError> = true;
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
  const _simShape: AssertExtends<Update.EmptyPlan, ErrOf<SimEff>> = true;
  const _simEmptyTarget: AssertExtends<Update.EmptyTarget, ErrOf<SimEff>> =
    true;
  const _simDupContract: AssertExtends<
    Update.DuplicateContract,
    ErrOf<SimEff>
  > = true;
  const _validateError: AssertEquals<ErrOf<SimEff>, ValidateError> = true;

  const _execBlocked: AssertExtends<Update.PlanBlocked, ErrOf<ExecEff>> = true;
  const _execContract: AssertExtends<
    Update.UpdateContractMismatch,
    ErrOf<ExecEff>
  > = true;
  const _execShape: AssertExtends<Update.EmptyStepTags, ErrOf<ExecEff>> = true;
  const _execCoversRestart: AssertExtends<
    ErrOf<RestartEff>,
    ErrOf<ExecEff>
  > = true;
  const _execError: AssertExtends<ErrOf<ExecEff>, ExecuteError> = true;
  const _execErrorRev: AssertExtends<ExecuteError, ErrOf<ExecEff>> = true;

  const _tag: "UpdatePlan" = planValue._tag;
  const _reportTag: "UpdateReport" = report._tag;
  const _order: number = planValue.steps[0]!.order;
  const _blocked: boolean = planValue.blocked;
  const _coUpdate: ReadonlyArray<string> = planValue.coUpdate;
  const _uncovered: ReadonlyArray<string> = planValue.uncoveredCoUpdate;
  const _target: string = step.target;
  const _prefer: boolean | undefined = step.prefer;
  const _forcePlanTime: boolean | undefined = step.force;
  const _steps: ReadonlyArray<Step> = input.steps;
  const _auditOk: boolean = audit.ok;
  const _reportAudit: ReadonlyArray<AuditEntry> = report.audit;
  const _isPlan: boolean = isPlanFn(planValue);
  const _isReport: boolean = isReportFn(report);
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
  void _hasEmptyTarget;
  void _hasEmptyKey;
  void _hasDup;
  void _hasDupContract;
  void _hasContract;
  void _hasBlocked;
  void _hasUnknown;
  void _planError;
  void _needsDirectory;
  void _needsAdvice;
  void _needsDialers;
  void _simOk;
  void _simBlocked;
  void _simContract;
  void _simShape;
  void _simEmptyTarget;
  void _simDupContract;
  void _validateError;
  void _execBlocked;
  void _execContract;
  void _execShape;
  void _execCoversRestart;
  void _execError;
  void _execErrorRev;
  void _tag;
  void _reportTag;
  void _order;
  void _blocked;
  void _coUpdate;
  void _uncovered;
  void _target;
  void _prefer;
  void _forcePlanTime;
  void _steps;
  void _auditOk;
  void _reportAudit;
  void _isPlan;
  void _isReport;
  void _reason;
  void _mismatchAudit;
  void _mismatchReason;
  void _liveTips;
  void planError;
  void validateError;
  void executeError;
}

void typeLock;
