/**
 * **Update** — compose a fleet cutover plan, simulate (validate), then execute.
 *
 * Consume as `import * as Update from "hyperlink-ts/Update"`.
 *
 * ```ts
 * const plan = yield* Update.plan({
 *   steps: [
 *     { target: "fleet/Mail", successor: mailB, tags: [Mail] },
 *     { target: "fleet/Jobs", successor: jobsB, tags: [Jobs] },
 *   ],
 *   contracts: [{ tag: Jobs, from: "jobs/payload@2", to: "jobs/payload@3" }],
 * })
 * yield* Update.simulate(plan) // fail closed — no spawn
 * yield* Update.execute(plan)  // ordered restartSuccessor steps
 * ```
 *
 * Separate from {@link Versioned} (schema chains). Custody/spawn stays on
 * {@link Launcher}; impact dry-run uses {@link Lookup.planUpdate}.
 *
 * @see `docs/guides/update.md`
 * @see `docs/handoffs/node-addresses-and-update-api.md`
 * @module Update
 */
export {
  plan,
  simulate,
  execute,
  isPlan,
  EmptyUpdatePlan,
  ContractMismatch,
  UpdatePlanBlocked,
} from "./internal/update";
export type {
  UpdateStep,
  ContractExpectation,
  PlanInput,
  PlannedStep,
  ContractAuditEntry,
  UpdatePlan,
  SimulateReport,
} from "./internal/update";

// Re-export impact/blocked types apps already use from Lookup for one-stop imports.
export type {
  PlanUpdateTag,
  UpdateImpact,
} from "./internal/lookupPlanUpdate";
export {
  UpdateBlocked,
  UpdateTargetUnknown,
} from "./internal/lookupPlanUpdate";
