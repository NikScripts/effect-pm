/**
 * Update — compose a fleet plan, simulate (validate), then execute.
 *
 * Plan is an inspectable value (impacts + contract audit). Execute re-validates
 * the plan value, then runs ordered steps via {@link Launcher.restartSuccessor}
 * with `skipPlan: true`. Simulate is the same gate without spawning — use with a
 * production-like Lookup+incumbent boot in tests.
 *
 * @module internal/update
 * @internal
 */
import { Data, Effect } from "effect";
import type * as Advice from "../Advice";
import type * as Dialers from "../Dialers";
import type * as Directory from "../Directory";
import * as Versioned from "../Versioned";
import {
  restartSuccessor,
  type SpawnSpec,
} from "./launcher";
import {
  planUpdate,
  type PlanUpdateTag,
  type UpdateImpact,
  UpdateBlocked,
  UpdateTargetUnknown,
} from "./lookupPlanUpdate";
import {
  itemSchemaOf,
  schemaVersionFromTag,
  versionInChain,
} from "./versioned";

// =============================================================================
// Models
// =============================================================================

/**
 * Why a {@link Contract} audit row failed.
 *
 * @category models
 * @public
 */
export type AuditReason = "From" | "To" | "Path";

/**
 * One node cutover step inside a {@link Plan}.
 *
 * @category models
 * @public
 */
export interface Step {
  /** Directory `nodeKey` of the outgoing node. */
  readonly target: string;
  /** Successor unit (new dial / same identity). */
  readonly successor: SpawnSpec;
  /** Tags the successor will serve — inputs to {@link planUpdate}. */
  readonly tags: ReadonlyArray<PlanUpdateTag>;
  /** Local Specs for the incumbent — enables wireRemovals. */
  readonly incumbent?: ReadonlyArray<PlanUpdateTag>;
  /** Override ambient plan force for this step. */
  readonly force?: boolean;
  /** Override ambient plan status dial for this step. */
  readonly status?: boolean;
  /** Skip {@link planUpdate} for this step (ops escape). */
  readonly skipPlan?: boolean;
  /**
   * After `up(B)`, stamp Advice.prefer per tag. Default `true`.
   */
  readonly prefer?: boolean;
}

/**
 * Optional contract from→to expectation for audit / fail-closed validation.
 *
 * @category models
 * @public
 */
export interface Contract {
  /** Successor (or shared) Tag whose tip is being asserted. */
  readonly tag: PlanUpdateTag;
  /** Expected live incumbent `schemaVersion` (when known). */
  readonly from?: string;
  /** Expected successor tip (`schemaVersionFromTag` / Versioned tip). */
  readonly to?: string;
}

/**
 * Input to {@link plan}.
 *
 * @category models
 * @public
 */
export interface Input {
  /**
   * Ordered steps — index is execution order (strategic handoff sequence).
   * Must be non-empty; each step needs at least one tag; targets must be unique.
   */
  readonly steps: ReadonlyArray<Step>;
  /** Optional contract from→to audit (fail closed when mismatched). */
  readonly contracts?: ReadonlyArray<Contract>;
  /** Default `force` for every step that omits its own. */
  readonly force?: boolean;
  /** Default `status` for every step that omits its own. */
  readonly status?: boolean;
}

/**
 * A step after planning — carries dry-run {@link UpdateImpact}.
 *
 * @category models
 * @public
 */
export interface PlannedStep extends Step {
  readonly order: number;
  readonly impact: UpdateImpact | undefined;
}

/**
 * One contract audit row on a {@link Plan}.
 *
 * @category models
 * @public
 */
export interface AuditEntry {
  readonly serviceKey: string;
  readonly expected: {
    readonly from: string | undefined;
    readonly to: string | undefined;
  };
  readonly observed: {
    readonly from: string | undefined;
    readonly to: string | undefined;
  };
  readonly ok: boolean;
  readonly reason: AuditReason | undefined;
}

/**
 * Inspectable fleet update plan — compose with {@link plan}, validate with
 * {@link simulate}, run with {@link execute}.
 *
 * @category models
 * @public
 */
export interface Plan {
  readonly _tag: "UpdatePlan";
  readonly steps: ReadonlyArray<PlannedStep>;
  readonly contracts: ReadonlyArray<Contract>;
  readonly audit: ReadonlyArray<AuditEntry>;
  /**
   * Union of per-step {@link UpdateImpact.coUpdate} peers (Directory nodes that
   * share a served key with a planned target).
   */
  readonly coUpdate: ReadonlyArray<string>;
  /**
   * `coUpdate` peers that are not themselves step targets — advisory; does not
   * set {@link Plan.blocked} (fleet coverage is still owner-shaped).
   */
  readonly uncoveredCoUpdate: ReadonlyArray<string>;
  /**
   * True when any step impact is blocked. Contract failures fail closed as
   * {@link UpdateContractMismatch} from {@link plan} / {@link simulate} /
   * {@link execute} rather than returning a plan with a failed audit.
   */
  readonly blocked: boolean;
}

/**
 * Report from {@link simulate} on a clean plan (no spawn).
 *
 * @category models
 * @public
 */
export interface Report {
  readonly plan: Plan;
  readonly audit: ReadonlyArray<AuditEntry>;
}

// =============================================================================
// Errors
// =============================================================================

/**
 * {@link plan} was called with an empty `steps` array.
 *
 * @category errors
 * @public
 */
export class EmptyPlan extends Data.TaggedError("EmptyUpdatePlan") {
  override get message() {
    return "Update.plan requires at least one step.";
  }
}

/**
 * A step declared `tags: []` — nothing to plan or spawn.
 *
 * @category errors
 * @public
 */
export class EmptyStepTags extends Data.TaggedError("EmptyUpdateStepTags")<{
  readonly target: string;
  readonly order: number;
}> {
  override get message() {
    return `Update step[${String(this.order)}] target "${this.target}" has empty tags.`;
  }
}

/**
 * Two steps share the same Directory `target` — fleet order would race.
 *
 * @category errors
 * @public
 */
export class DuplicateTarget extends Data.TaggedError("DuplicateUpdateTarget")<{
  readonly target: string;
  readonly orders: ReadonlyArray<number>;
}> {
  override get message() {
    return `Update plan duplicates target "${this.target}" at steps [${this.orders.join(", ")}].`;
  }
}

/**
 * A {@link Contract} did not match observed tips / Versioned path.
 *
 * Distinct `_tag` from Node verify `ContractMismatch` (binary Spec drift).
 * Carries the full {@link audit} so multi-contract plans stay inspectable.
 *
 * @category errors
 * @public
 */
export class UpdateContractMismatch extends Data.TaggedError(
  "UpdateContractMismatch",
)<{
  readonly serviceKey: string;
  readonly expected: {
    readonly from: string | undefined;
    readonly to: string | undefined;
  };
  readonly observed: {
    readonly from: string | undefined;
    readonly to: string | undefined;
  };
  readonly reason: AuditReason;
  readonly audit: ReadonlyArray<AuditEntry>;
}> {
  override get message() {
    return `Update contract mismatch for "${this.serviceKey}" (${this.reason}): expected from=${String(this.expected.from)} to=${String(this.expected.to)}, observed from=${String(this.observed.from)} to=${String(this.observed.to)}.`;
  }
}

/**
 * Plan has hard blockers (step impact blocked after contract audit passed).
 *
 * @category errors
 * @public
 */
export class PlanBlocked extends Data.TaggedError("UpdatePlanBlocked")<{
  readonly plan: Plan;
}> {
  override get message() {
    const targets = this.plan.steps
      .filter((s) => s.impact?.blocked === true)
      .map((s) => s.target);
    return targets.length === 0
      ? "Update plan is blocked."
      : `Update plan blocked for target(s): ${targets.join(", ")}.`;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Live incumbent tip for `serviceKey` on the step **target** only. */
const observedFromInImpacts = (
  serviceKey: string,
  impacts: ReadonlyArray<UpdateImpact | undefined>,
): string | undefined => {
  for (const impact of impacts) {
    if (impact === undefined) continue;
    const gap = impact.migrationGaps.find((g) => g.serviceKey === serviceKey);
    if (gap !== undefined) return gap.from;
    const tip = impact.liveTips.find(
      (row) =>
        row.serviceKey === serviceKey &&
        row.node === impact.target &&
        row.schemaVersion !== undefined,
    );
    if (tip?.schemaVersion !== undefined) return tip.schemaVersion;
  }
  return undefined;
};

const auditContracts = (
  contracts: ReadonlyArray<Contract>,
  impacts: ReadonlyArray<UpdateImpact | undefined>,
): {
  readonly audit: ReadonlyArray<AuditEntry>;
  readonly mismatch: UpdateContractMismatch | undefined;
} => {
  const audit: Array<AuditEntry> = [];
  let mismatch: UpdateContractMismatch | undefined;
  for (const c of contracts) {
    const serviceKey = c.tag.key;
    const observedTo = schemaVersionFromTag(c.tag);
    const observedFrom = observedFromInImpacts(serviceKey, impacts);
    let ok = true;
    let reason: AuditReason | undefined;

    if (c.to !== undefined && observedTo !== c.to) {
      ok = false;
      reason = "To";
    } else if (c.from !== undefined) {
      if (observedFrom !== undefined) {
        if (observedFrom !== c.from) {
          ok = false;
          reason = "From";
        }
      } else if (c.to !== undefined) {
        // No live tip / gap — verify Versioned path from→to when schemas allow.
        const item = itemSchemaOf(c.tag);
        if (
          item !== undefined &&
          Versioned.isVersioned(item) &&
          c.from !== c.to &&
          !versionInChain(item, c.from)
        ) {
          ok = false;
          reason = "Path";
        }
      } else {
        // Asserted `from` with nothing observed and no `to` for a path check.
        ok = false;
        reason = "From";
      }
    }

    const entry: AuditEntry = {
      serviceKey,
      expected: { from: c.from, to: c.to },
      observed: { from: observedFrom, to: observedTo },
      ok,
      reason,
    };
    audit.push(entry);
  }
  const bad = audit.find((a) => !a.ok);
  if (bad !== undefined && bad.reason !== undefined) {
    mismatch = new UpdateContractMismatch({
      serviceKey: bad.serviceKey,
      expected: bad.expected,
      observed: bad.observed,
      reason: bad.reason,
      audit,
    });
  }
  return { audit, mismatch };
};

const rollupCoUpdate = (
  planned: ReadonlyArray<PlannedStep>,
): {
  readonly coUpdate: ReadonlyArray<string>;
  readonly uncoveredCoUpdate: ReadonlyArray<string>;
} => {
  const targets = new Set(planned.map((s) => s.target));
  const peers = new Set<string>();
  for (const step of planned) {
    for (const peer of step.impact?.coUpdate ?? []) {
      peers.add(peer);
    }
  }
  const coUpdate = [...peers].sort();
  const uncoveredCoUpdate = coUpdate.filter((peer) => !targets.has(peer));
  return { coUpdate, uncoveredCoUpdate };
};

const validateSteps = (
  steps: ReadonlyArray<Step>,
): EmptyPlan | EmptyStepTags | DuplicateTarget | undefined => {
  if (steps.length === 0) return new EmptyPlan();
  const seen = new Map<string, Array<number>>();
  for (const [order, step] of steps.entries()) {
    if (step.tags.length === 0) {
      return new EmptyStepTags({ target: step.target, order });
    }
    const orders = seen.get(step.target);
    if (orders === undefined) seen.set(step.target, [order]);
    else orders.push(order);
  }
  for (const [target, orders] of seen) {
    if (orders.length > 1) {
      return new DuplicateTarget({ target, orders });
    }
  }
  return undefined;
};

const impactBlocked = (plan: Plan): boolean =>
  plan.steps.some((s) => s.impact?.blocked === true);

/**
 * Shared simulate/execute gate — re-audit contracts; refuse blocked impacts.
 */
const validatePlan = (
  updatePlan: Plan,
): Effect.Effect<
  { readonly plan: Plan; readonly audit: ReadonlyArray<AuditEntry> },
  PlanBlocked | UpdateContractMismatch
> =>
  Effect.gen(function* () {
    const { audit, mismatch } = auditContracts(
      updatePlan.contracts,
      updatePlan.steps.map((s) => s.impact),
    );
    if (mismatch !== undefined) {
      return yield* mismatch;
    }
    const blocked = impactBlocked(updatePlan);
    const next: Plan = { ...updatePlan, audit, blocked };
    if (blocked) {
      return yield* new PlanBlocked({ plan: next });
    }
    return { plan: next, audit };
  });

type PlanError =
  | EmptyPlan
  | EmptyStepTags
  | DuplicateTarget
  | UpdateBlocked
  | UpdateTargetUnknown
  | UpdateContractMismatch;

type RestartSuccessorEffect = ReturnType<typeof restartSuccessor>;
type ExecuteError =
  | PlanBlocked
  | UpdateContractMismatch
  | Effect.Error<RestartSuccessorEffect>;
type ExecuteEnv = Effect.Services<RestartSuccessorEffect>;

type PlanServices =
  | Directory.Service
  | Advice.Service
  | Dialers.Service;

// =============================================================================
// Public API
// =============================================================================

/**
 * Compose an inspectable {@link Plan}: run {@link planUpdate} per step (in
 * order), audit optional contracts, fail closed on blockers / mismatches.
 *
 * @example
 * ```ts
 * const plan = yield* Update.plan({
 *   steps: [
 *     { target: "fleet/Mail", successor: mailB, tags: [Mail] },
 *     { target: "fleet/Jobs", successor: jobsB, tags: [Jobs] },
 *   ],
 *   contracts: [{ tag: Jobs, from: "jobs/payload@2", to: "jobs/payload@3" }],
 * })
 * ```
 *
 * @category constructors
 * @public
 */
export const plan = (
  input: Input,
): Effect.Effect<Plan, PlanError, PlanServices> =>
  Effect.gen(function* () {
    const invalid = validateSteps(input.steps);
    if (invalid !== undefined) {
      return yield* invalid;
    }

    const planned: Array<PlannedStep> = [];
    for (const [order, step] of input.steps.entries()) {
      const force = step.force ?? input.force;
      const status = step.status ?? input.status;
      let impact: UpdateImpact | undefined;
      if (step.skipPlan !== true) {
        impact = yield* planUpdate(step.target, step.tags, {
          ...(step.incumbent !== undefined
            ? { incumbent: step.incumbent }
            : {}),
          ...(force !== undefined ? { force } : {}),
          ...(status !== undefined ? { status } : {}),
        });
      }
      planned.push({
        ...step,
        order,
        impact,
        ...(force !== undefined ? { force } : {}),
        ...(status !== undefined ? { status } : {}),
      });
    }

    const contracts = input.contracts ?? [];
    const { audit, mismatch } = auditContracts(
      contracts,
      planned.map((s) => s.impact),
    );
    if (mismatch !== undefined) {
      return yield* mismatch;
    }

    const { coUpdate, uncoveredCoUpdate } = rollupCoUpdate(planned);
    const blocked = planned.some((s) => s.impact?.blocked === true);

    return {
      _tag: "UpdatePlan" as const,
      steps: planned,
      contracts,
      audit,
      coUpdate,
      uncoveredCoUpdate,
      blocked,
    };
  });

/**
 * Validate a {@link Plan} without spawning — re-checks contract audit and
 * blocked flags (pure plan-value gate; does not re-dial Directory/status).
 *
 * For a full production-like mock: boot Lookup + incumbents, then
 * `plan` → `simulate` → `execute` (see guide / dream-redeploy suite).
 *
 * @category validators
 * @public
 */
export const simulate = (
  updatePlan: Plan,
): Effect.Effect<Report, PlanBlocked | UpdateContractMismatch> =>
  Effect.map(validatePlan(updatePlan), ({ plan: next, audit }) => ({
    plan: next,
    audit,
  }));

/**
 * Execute a validated {@link Plan} — re-runs the {@link simulate} gate, then
 * ordered {@link restartSuccessor} steps with `skipPlan: true`.
 *
 * Returns each step's **planned** impact (execute does not re-run planUpdate).
 * `force: true` on {@link plan} is for inspecting blocked impacts — execute
 * still refuses until the plan is unblocked.
 *
 * @category constructors
 * @public
 */
export const execute = (
  updatePlan: Plan,
): Effect.Effect<
  ReadonlyArray<UpdateImpact | undefined>,
  ExecuteError,
  ExecuteEnv
> =>
  Effect.gen(function* () {
    const { plan: next } = yield* validatePlan(updatePlan);
    const impacts: Array<UpdateImpact | undefined> = [];
    for (const step of next.steps) {
      // Plan already ran — only custody flags belong here (prefer).
      yield* restartSuccessor({
        target: step.target,
        successor: step.successor,
        tags: step.tags,
        skipPlan: true,
        ...(step.prefer !== undefined ? { prefer: step.prefer } : {}),
      });
      impacts.push(step.impact);
    }
    return impacts;
  });

/**
 * Type guard for {@link Plan}.
 *
 * Checks `_tag` plus the inspectable shape apps/CI assert on (steps, audit,
 * coUpdate rollups, blocked). Does not deep-validate impacts.
 *
 * @category refinements
 * @public
 */
export const isPlan = (u: unknown): u is Plan => {
  if (typeof u !== "object" || u === null) return false;
  if (!("_tag" in u) || u._tag !== "UpdatePlan") return false;
  if (!("steps" in u) || !Array.isArray(u.steps)) return false;
  if (!("audit" in u) || !Array.isArray(u.audit)) return false;
  if (!("contracts" in u) || !Array.isArray(u.contracts)) return false;
  if (!("coUpdate" in u) || !Array.isArray(u.coUpdate)) return false;
  if (!("uncoveredCoUpdate" in u) || !Array.isArray(u.uncoveredCoUpdate)) {
    return false;
  }
  if (!("blocked" in u) || typeof u.blocked !== "boolean") return false;
  return true;
};
