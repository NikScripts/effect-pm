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
  EmptyPlan,
  EmptyStepTags,
  DuplicateTarget,
  UpdateContractMismatch,
  PlanBlocked,
} from "./internal/update";
export type {
  Step,
  Contract,
  Input,
  PlannedStep,
  AuditEntry,
  AuditReason,
  Plan,
  Report,
} from "./internal/update";

/** Impact dry-run types / errors — SSOT on {@link Lookup}. */
export type { PlanUpdateTag, UpdateImpact } from "./Lookup";
export { UpdateBlocked, UpdateTargetUnknown } from "./Lookup";
