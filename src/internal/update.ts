/**
 * Update — compose a fleet plan, simulate (validate), then execute.
 *
 * Plan is an inspectable value (impacts + contract audit). Execute re-validates
 * the plan value (shape + re-derived blockers + contracts), then runs ordered
 * steps via {@link Launcher.restartSuccessor} with `skipPlan: true`. Simulate
 * is the same gate without spawning — use with a production-like Lookup+incumbent
 * boot in tests.
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
  /** Directory `nodeKey` of the outgoing node (non-empty after trim). */
  readonly target: string;
  /** Successor unit (new dial / same identity). */
  readonly successor: SpawnSpec;
  /** Tags the successor will serve — inputs to {@link planUpdate}. */
  readonly tags: ReadonlyArray<PlanUpdateTag>;
  /**
   * Local Specs for the incumbent — enables wireRemovals.
   * Plan-time only: execute does not forward this to custody.
   */
  readonly incumbent?: ReadonlyArray<PlanUpdateTag>;
  /**
   * Override ambient {@link Lookup.planForce} for this step's dry-run.
   * Plan-time only — does not bypass {@link simulate} / {@link execute}.
   */
  readonly force?: boolean;
  /**
   * Override ambient {@link Lookup.planStatus} for this step's dry-run.
   * Plan-time only: execute does not re-dial status.
   */
  readonly status?: boolean;
  /**
   * Skip {@link planUpdate} for this step (ops escape; impact is `undefined`).
   * Plan-time only — execute always uses `skipPlan: true` on custody.
   */
  readonly skipPlan?: boolean;
  /**
   * After `up(B)`, stamp Advice.prefer per tag. Default `true` (or
   * {@link Input.prefer} when set). Forwarded to
   * {@link Launcher.restartSuccessor} on execute.
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
   * Must be non-empty; each step needs at least one tag with a non-blank key;
   * targets must be unique and non-blank.
   */
  readonly steps: ReadonlyArray<Step>;
  /**
   * Optional contract from→to audit (fail closed when mismatched).
   * Service keys must be unique across the list.
   */
  readonly contracts?: ReadonlyArray<Contract>;
  /**
   * Default `force` for every step that omits its own.
   * Distinct from ambient {@link Lookup.planForce} — either can collect a
   * blocked impact onto the plan; neither lets execute through.
   */
  readonly force?: boolean;
  /** Default `status` for every step that omits its own. */
  readonly status?: boolean;
  /**
   * Default `prefer` for every step that omits its own.
   * Forwarded to custody on {@link execute} (unlike plan-time `force` / `status`).
   */
  readonly prefer?: boolean;
}

/**
 * A step after planning — carries dry-run {@link UpdateImpact}.
 *
 * Fields `force`, `status`, `incumbent`, and `skipPlan` are plan-time metadata
 * retained for inspectability; {@link execute} only forwards `prefer` to
 * custody (plus `target` / `successor` / `tags` with `skipPlan: true`).
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
   * Step targets whose impact flagged `lookupFirst` — schedule Lookup cutovers
   * before app nodes that depend on membership.
   */
  readonly lookupFirst: ReadonlyArray<string>;
  /**
   * True when any step impact has hard blocker arrays (re-derived from
   * `wireRemovals` / `migrationGaps` / `contractDrifts` — not a forgeable flag).
   * Contract failures fail closed as {@link UpdateContractMismatch} rather than
   * returning a plan with a failed audit.
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
  readonly _tag: "UpdateReport";
  readonly plan: Plan;
  readonly audit: ReadonlyArray<AuditEntry>;
}

// =============================================================================
// Blocker helpers (used by errors + gate)
// =============================================================================

/**
 * Hard blockers are the impact arrays — never trust a forgeable `blocked` flag.
 */
const impactArraysBlocked = (impact: UpdateImpact | undefined): boolean =>
  impact !== undefined &&
  (impact.wireRemovals.length > 0 ||
    impact.migrationGaps.length > 0 ||
    impact.contractDrifts.length > 0);

/** Re-stamp `impact.blocked` from arrays (identity when already consistent). */
const rederiveImpact = (
  impact: UpdateImpact | undefined,
): UpdateImpact | undefined => {
  if (impact === undefined) return undefined;
  const blocked = impactArraysBlocked(impact);
  return impact.blocked === blocked ? impact : { ...impact, blocked };
};

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
 * A step `target` is empty, whitespace-only, or has leading/trailing space.
 *
 * Directory `nodeKey` matching is exact — untrimmed targets are refused.
 *
 * @category errors
 * @public
 */
export class EmptyTarget extends Data.TaggedError("EmptyUpdateTarget")<{
  readonly order: number;
}> {
  override get message() {
    return `Update step[${String(this.order)}] has an empty or untrimmed target.`;
  }
}

/**
 * A step tag (or contract tag) has a blank or untrimmed `key`.
 *
 * @category errors
 * @public
 */
export class EmptyTagKey extends Data.TaggedError("EmptyUpdateTagKey")<{
  readonly target: string;
  readonly order: number;
  readonly role: "step" | "contract";
}> {
  override get message() {
    return this.role === "contract"
      ? `Update contract[${String(this.order)}] has a blank or untrimmed tag key.`
      : `Update step[${String(this.order)}] target "${this.target}" has a blank or untrimmed tag key.`;
  }
}

/**
 * A step lists the same `tag.key` more than once.
 *
 * @category errors
 * @public
 */
export class DuplicateTag extends Data.TaggedError("DuplicateUpdateTag")<{
  readonly target: string;
  readonly serviceKey: string;
  readonly order: number;
}> {
  override get message() {
    return `Update step[${String(this.order)}] target "${this.target}" duplicates tag "${this.serviceKey}".`;
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
 * Two {@link Contract} rows share the same `tag.key`.
 *
 * @category errors
 * @public
 */
export class DuplicateContract extends Data.TaggedError(
  "DuplicateUpdateContract",
)<{
  readonly serviceKey: string;
}> {
  override get message() {
    return `Update plan duplicates contract for "${this.serviceKey}".`;
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
      .filter((s) => impactArraysBlocked(s.impact))
      .map((s) => s.target);
    return targets.length === 0
      ? "Update plan is blocked."
      : `Update plan blocked for target(s): ${targets.join(", ")}.`;
  }
}

/**
 * Failures from {@link plan} (shape + impact dry-run + contracts).
 *
 * @category errors
 * @public
 */
export type PlanError =
  | EmptyPlan
  | EmptyStepTags
  | EmptyTarget
  | EmptyTagKey
  | DuplicateTarget
  | DuplicateTag
  | DuplicateContract
  | UpdateBlocked
  | UpdateTargetUnknown
  | UpdateContractMismatch;

/**
 * Failures from the shared simulate/execute plan-value gate.
 *
 * @category errors
 * @public
 */
export type ValidateError =
  | EmptyPlan
  | EmptyStepTags
  | EmptyTarget
  | EmptyTagKey
  | DuplicateTarget
  | DuplicateTag
  | DuplicateContract
  | PlanBlocked
  | UpdateContractMismatch;

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
        // No live tip / gap — Versioned path from→to, else fail closed.
        const item = itemSchemaOf(c.tag);
        if (item !== undefined && Versioned.isVersioned(item)) {
          if (c.from !== c.to && !versionInChain(item, c.from)) {
            ok = false;
            reason = "Path";
          }
        } else {
          ok = false;
          reason = "From";
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
  readonly lookupFirst: ReadonlyArray<string>;
} => {
  const targets = new Set(planned.map((s) => s.target));
  const peers = new Set<string>();
  const lookupFirst: Array<string> = [];
  for (const step of planned) {
    for (const peer of step.impact?.coUpdate ?? []) {
      peers.add(peer);
    }
    if (step.impact?.lookupFirst === true) {
      lookupFirst.push(step.target);
    }
  }
  const coUpdate = [...peers].sort();
  const uncoveredCoUpdate = coUpdate.filter((peer) => !targets.has(peer));
  return { coUpdate, uncoveredCoUpdate, lookupFirst };
};

type ShapeError =
  | EmptyPlan
  | EmptyStepTags
  | EmptyTarget
  | EmptyTagKey
  | DuplicateTarget
  | DuplicateTag;

const validateSteps = (steps: ReadonlyArray<Step>): ShapeError | undefined => {
  if (steps.length === 0) return new EmptyPlan();
  const seen = new Map<string, Array<number>>();
  for (const [order, step] of steps.entries()) {
    // Reject empty / whitespace-only and untrimmed targets (Directory keys are exact).
    if (step.target.trim().length === 0 || step.target !== step.target.trim()) {
      return new EmptyTarget({ order });
    }
    if (step.tags.length === 0) {
      return new EmptyStepTags({ target: step.target, order });
    }
    const tagKeys = new Set<string>();
    for (const tag of step.tags) {
      if (tag.key.trim().length === 0 || tag.key !== tag.key.trim()) {
        return new EmptyTagKey({
          target: step.target,
          order,
          role: "step",
        });
      }
      if (tagKeys.has(tag.key)) {
        return new DuplicateTag({
          target: step.target,
          serviceKey: tag.key,
          order,
        });
      }
      tagKeys.add(tag.key);
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

const validateContracts = (
  contracts: ReadonlyArray<Contract>,
): EmptyTagKey | DuplicateContract | undefined => {
  const seen = new Set<string>();
  for (const [order, c] of contracts.entries()) {
    const key = c.tag.key;
    if (key.trim().length === 0 || key !== key.trim()) {
      return new EmptyTagKey({
        target: "",
        order,
        role: "contract",
      });
    }
    if (seen.has(key)) {
      return new DuplicateContract({ serviceKey: key });
    }
    seen.add(key);
  }
  return undefined;
};

const withUpdatePhase = <A, E, R>(
  phase: string,
  effect: Effect.Effect<A, E, R>,
  attributes?: Record<string, string>,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.annotateLogs({
      "update.phase": phase,
      ...attributes,
    }),
    Effect.withLogSpan(`update.${phase}`),
    Effect.withSpan(`update.${phase}`, {
      attributes: {
        "update.phase": phase,
        ...attributes,
      },
    }),
  );

/**
 * Shared simulate/execute gate — re-check shape, re-audit contracts, re-derive
 * blockers from impact arrays (refuse forged `blocked: false`).
 */
const validatePlan = (
  updatePlan: Plan,
): Effect.Effect<
  { readonly plan: Plan; readonly audit: ReadonlyArray<AuditEntry> },
  ValidateError
> =>
  withUpdatePhase(
    "validate",
    Effect.gen(function* () {
      const shape = validateSteps(updatePlan.steps);
      if (shape !== undefined) {
        return yield* shape;
      }
      const contractsInvalid = validateContracts(updatePlan.contracts);
      if (contractsInvalid !== undefined) {
        return yield* contractsInvalid;
      }

      const steps = updatePlan.steps.map((step) => {
        const impact = rederiveImpact(step.impact);
        return impact === step.impact ? step : { ...step, impact };
      });
      const { audit, mismatch } = auditContracts(
        updatePlan.contracts,
        steps.map((s) => s.impact),
      );
      if (mismatch !== undefined) {
        return yield* mismatch;
      }

      const blocked = steps.some((s) => impactArraysBlocked(s.impact));
      const { coUpdate, uncoveredCoUpdate, lookupFirst } =
        rollupCoUpdate(steps);
      const next: Plan = {
        ...updatePlan,
        steps,
        audit,
        blocked,
        coUpdate,
        uncoveredCoUpdate,
        lookupFirst,
      };
      if (blocked) {
        return yield* new PlanBlocked({ plan: next });
      }
      return { plan: next, audit };
    }),
    {
      "update.steps": String(updatePlan.steps.length),
      "update.contracts": String(updatePlan.contracts.length),
    },
  );

type RestartSuccessorEffect = ReturnType<typeof restartSuccessor>;

/**
 * Failures from {@link execute} (validate gate + custody).
 *
 * @category errors
 * @public
 */
export type ExecuteError = ValidateError | Effect.Error<RestartSuccessorEffect>;

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
  withUpdatePhase(
    "plan",
    Effect.gen(function* () {
      const invalid = validateSteps(input.steps);
      if (invalid !== undefined) {
        return yield* invalid;
      }
      const contracts = input.contracts ?? [];
      const contractsInvalid = validateContracts(contracts);
      if (contractsInvalid !== undefined) {
        return yield* contractsInvalid;
      }

      const planned: Array<PlannedStep> = [];
      for (const [order, step] of input.steps.entries()) {
        const force = step.force ?? input.force;
        const status = step.status ?? input.status;
        const prefer = step.prefer ?? input.prefer;
        let impact: UpdateImpact | undefined;
        if (step.skipPlan !== true) {
          impact = yield* planUpdate(step.target, step.tags, {
            ...(step.incumbent !== undefined
              ? { incumbent: step.incumbent }
              : {}),
            ...(force !== undefined ? { force } : {}),
            ...(status !== undefined ? { status } : {}),
          }).pipe(
            Effect.annotateLogs({
              "update.target": step.target,
              "update.order": String(order),
            }),
          );
        }
        planned.push({
          ...step,
          order,
          impact: rederiveImpact(impact),
          ...(force !== undefined ? { force } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(prefer !== undefined ? { prefer } : {}),
        });
      }

      const { audit, mismatch } = auditContracts(
        contracts,
        planned.map((s) => s.impact),
      );
      if (mismatch !== undefined) {
        return yield* mismatch;
      }

      const { coUpdate, uncoveredCoUpdate, lookupFirst } =
        rollupCoUpdate(planned);
      const blocked = planned.some((s) => impactArraysBlocked(s.impact));

      return {
        _tag: "UpdatePlan" as const,
        steps: planned,
        contracts,
        audit,
        coUpdate,
        uncoveredCoUpdate,
        lookupFirst,
        blocked,
      };
    }),
    {
      "update.steps": String(input.steps.length),
      "update.contracts": String(input.contracts?.length ?? 0),
    },
  );

/**
 * Validate a {@link Plan} without spawning — re-checks shape, contract audit,
 * and blockers re-derived from impact arrays (pure plan-value gate; does not
 * re-dial Directory/status).
 *
 * For a full production-like mock: boot Lookup + incumbents, then
 * `plan` → `simulate` → `execute` (see guide / dream-redeploy suite).
 *
 * @category validators
 * @public
 */
export const simulate = (
  updatePlan: Plan,
): Effect.Effect<Report, ValidateError> =>
  withUpdatePhase(
    "simulate",
    Effect.map(validatePlan(updatePlan), ({ plan: next, audit }) => ({
      _tag: "UpdateReport" as const,
      plan: next,
      audit,
    })),
  );

/**
 * Execute a validated {@link Plan} — re-runs the {@link simulate} gate, then
 * ordered {@link restartSuccessor} steps with `skipPlan: true`.
 *
 * Returns each step's **planned** impact (execute does not re-run planUpdate).
 * `force: true` on {@link plan} (or ambient {@link Lookup.planForce}) is for
 * inspecting blocked impacts — execute still refuses until the plan is
 * unblocked. Only step `prefer` is forwarded to custody.
 *
 * Steps run in array order and **short-circuit** on the first custody failure
 * (earlier steps already cut over; no automatic rollback — fleet recovery is
 * owner-shaped).
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
  withUpdatePhase(
    "execute",
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
        }).pipe(
          Effect.annotateLogs({
            "update.target": step.target,
            "update.order": String(step.order),
            "update.prefer": String(step.prefer !== false),
          }),
        );
        impacts.push(step.impact);
      }
      return impacts;
    }),
    {
      "update.steps": String(updatePlan.steps.length),
      "update.contracts": String(updatePlan.contracts.length),
    },
  );

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
  if (!("lookupFirst" in u) || !Array.isArray(u.lookupFirst)) return false;
  if (!("blocked" in u) || typeof u.blocked !== "boolean") return false;
  return true;
};

/**
 * Type guard for {@link Report}.
 *
 * @category refinements
 * @public
 */
export const isReport = (u: unknown): u is Report => {
  if (typeof u !== "object" || u === null) return false;
  if (!("_tag" in u) || u._tag !== "UpdateReport") return false;
  if (!("plan" in u) || !isPlan(u.plan)) return false;
  if (!("audit" in u) || !Array.isArray(u.audit)) return false;
  return true;
};
