/**
 * Type-level lock: Update.plan / simulate / execute channels + plan shape.
 */
import type { Effect } from "effect";
import type * as Advice from "../src/Advice";
import type * as Dialers from "../src/Dialers";
import type * as Directory from "../src/Directory";
import type {
  ContractAuditEntry,
  PlanInput,
  SimulateReport,
  UpdatePlan,
  UpdateStep,
} from "../src/Update";
import type * as Update from "../src/Update";

type ErrOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;
type CtxOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
type OkOf<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;
type AssertExtends<A, B> = [A] extends [B] ? true : false;

function typeLock(
  planFn: typeof Update.plan,
  simulateFn: typeof Update.simulate,
  executeFn: typeof Update.execute,
  isPlanFn: typeof Update.isPlan,
  planValue: UpdatePlan,
  step: UpdateStep,
  input: PlanInput,
  audit: ContractAuditEntry,
  report: SimulateReport,
): void {
  type PlanEff = ReturnType<typeof planFn>;
  type SimEff = ReturnType<typeof simulateFn>;
  type ExecEff = ReturnType<typeof executeFn>;

  const _planOk: AssertExtends<UpdatePlan, OkOf<PlanEff>> = true;
  const _hasEmpty: AssertExtends<Update.EmptyUpdatePlan, ErrOf<PlanEff>> = true;
  const _hasContract: AssertExtends<Update.ContractMismatch, ErrOf<PlanEff>> =
    true;
  const _hasBlocked: AssertExtends<Update.UpdateBlocked, ErrOf<PlanEff>> = true;
  const _hasUnknown: AssertExtends<Update.UpdateTargetUnknown, ErrOf<PlanEff>> =
    true;
  const _needsDirectory: AssertExtends<Directory.Service, CtxOf<PlanEff>> =
    true;
  const _needsAdvice: AssertExtends<Advice.Service, CtxOf<PlanEff>> = true;
  const _needsDialers: AssertExtends<Dialers.Service, CtxOf<PlanEff>> = true;

  const _simOk: AssertExtends<SimulateReport, OkOf<SimEff>> = true;
  const _simBlocked: AssertExtends<
    Update.UpdatePlanBlocked,
    ErrOf<SimEff>
  > = true;
  const _simContract: AssertExtends<Update.ContractMismatch, ErrOf<SimEff>> =
    true;

  const _execBlocked: AssertExtends<
    Update.UpdatePlanBlocked,
    ErrOf<ExecEff>
  > = true;

  const _tag: "UpdatePlan" = planValue._tag;
  const _order: number = planValue.steps[0]!.order;
  const _blocked: boolean = planValue.blocked;
  const _target: string = step.target;
  const _steps: ReadonlyArray<UpdateStep> = input.steps;
  const _auditOk: boolean = audit.ok;
  const _reportOk: boolean = report.ok;
  const _isPlan: boolean = isPlanFn(planValue);

  void _planOk;
  void _hasEmpty;
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
  void _tag;
  void _order;
  void _blocked;
  void _target;
  void _steps;
  void _auditOk;
  void _reportOk;
  void _isPlan;
}

void typeLock;
