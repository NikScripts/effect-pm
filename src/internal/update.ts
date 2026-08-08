/**
 * Update — compose a fleet plan, simulate (validate), then execute.
 *
 * Plan is an inspectable value (impacts + contract audit). Execute runs ordered
 * steps via {@link Launcher.restartSuccessor} with `skipPlan: true` (planning
 * already happened). Simulate re-validates contracts / blocked state without
 * spawning — use with a production-like Lookup+incumbent boot in tests.
 *
 * @module internal/update
 * @internal
 */
import {
  Data,
  Effect,
  Schema,
  type Scope,
} from "effect";
import type { ConfigError } from "effect/Config";
import type { PlatformError } from "effect/PlatformError";
import type { ChildProcessSpawner } from "effect/unstable/process";
import * as Advice from "../Advice";
import * as Dialers from "../Dialers";
import * as Directory from "../Directory";
import type { HandoffDeferred } from "../Hyperlink";
import * as Versioned from "../Versioned";
import {
  AssumeNotReady,
  AssumeTokenMismatch,
  AssumeTokenReused,
} from "./nodeAssume";
import {
  restartSuccessor,
  type SpawnSpec,
  ChildExited,
  HandleNotReady,
  HandleSpent,
  LookupAddressRequired,
  LookupNotRunning,
  NodeAlreadyUp,
  ReadyTimedOut,
} from "./launcher";
import {
  planUpdate,
  type PlanUpdateTag,
  type UpdateImpact,
  UpdateBlocked,
  UpdateTargetUnknown,
} from "./lookupPlanUpdate";
import {
  NodeUnreachable,
  ProtocolUnanswered,
  ServiceNotReady,
  ServiceNotServed,
  UnaddressedNode,
} from "./nodeCore";
import { schemaVersionFromTag } from "./versioned";

// =============================================================================
// Models
// =============================================================================

/**
 * One node cutover step inside an {@link UpdatePlan}.
 *
 * @category models
 * @public
 */
export interface UpdateStep {
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
   * After `up(B)`, stamp {@link Advice.prefer} per tag. Default `true`.
   */
  readonly prefer?: boolean;
}

/**
 * Optional contract from→to expectation for audit / fail-closed validation.
 *
 * @category models
 * @public
 */
export interface ContractExpectation {
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
export interface PlanInput {
  /**
   * Ordered steps — index is execution order (strategic handoff sequence).
   * Must be non-empty.
   */
  readonly steps: ReadonlyArray<UpdateStep>;
  /** Optional contract from→to audit (fail closed when mismatched). */
  readonly contracts?: ReadonlyArray<ContractExpectation>;
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
export interface PlannedStep extends UpdateStep {
  readonly order: number;
  readonly impact: UpdateImpact | undefined;
}

/**
 * One contract audit row on an {@link UpdatePlan}.
 *
 * @category models
 * @public
 */
export interface ContractAuditEntry {
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
  readonly reason: "from" | "to" | "path" | undefined;
}

/**
 * Inspectable fleet update plan — compose with {@link plan}, validate with
 * {@link simulate}, run with {@link execute}.
 *
 * @category models
 * @public
 */
export interface UpdatePlan {
  readonly _tag: "UpdatePlan";
  readonly steps: ReadonlyArray<PlannedStep>;
  readonly contracts: ReadonlyArray<ContractExpectation>;
  readonly audit: ReadonlyArray<ContractAuditEntry>;
  /** True when any step impact is blocked or any contract audit failed. */
  readonly blocked: boolean;
}

/**
 * Report from {@link simulate} — same audit, no spawn.
 *
 * @category models
 * @public
 */
export interface SimulateReport {
  readonly plan: UpdatePlan;
  readonly ok: boolean;
  readonly audit: ReadonlyArray<ContractAuditEntry>;
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
export class EmptyUpdatePlan extends Data.TaggedError("EmptyUpdatePlan") {}

/**
 * A {@link ContractExpectation} did not match observed tips / Versioned path.
 *
 * @category errors
 * @public
 */
export class ContractMismatch extends Data.TaggedError("ContractMismatch")<{
  readonly serviceKey: string;
  readonly expected: {
    readonly from: string | undefined;
    readonly to: string | undefined;
  };
  readonly observed: {
    readonly from: string | undefined;
    readonly to: string | undefined;
  };
  readonly reason: "from" | "to" | "path";
}> {}

/**
 * Plan has hard blockers (step impact or contract audit) and was not forced.
 *
 * @category errors
 * @public
 */
export class UpdatePlanBlocked extends Data.TaggedError("UpdatePlanBlocked")<{
  readonly plan: UpdatePlan;
}> {}

// =============================================================================
// Helpers
// =============================================================================

const workPoolItemSchemaSym = Symbol.for("hyperlink-ts/WorkPool/itemSchema");

const itemSchemaOf = (tag: PlanUpdateTag): unknown => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    workPoolItemSchemaSym in tag
  ) {
    return Reflect.get(tag, workPoolItemSchemaSym);
  }
  return undefined;
};

const versionInChain = (schema: unknown, from: string): boolean => {
  if (!Versioned.isVersioned(schema)) {
    return Schema.isSchema(schema) && Versioned.schemaVersion(schema) === from;
  }
  return schema[Versioned.VersionedTypeId].steps.some(
    (step: { readonly version: string }) => step.version === from,
  );
};

const observedFromInImpacts = (
  serviceKey: string,
  impacts: ReadonlyArray<UpdateImpact | undefined>,
): string | undefined => {
  for (const impact of impacts) {
    if (impact === undefined) continue;
    const gap = impact.migrationGaps.find((g) => g.serviceKey === serviceKey);
    if (gap !== undefined) return gap.from;
    // Same tip / path ok — migrationGaps empty; fall through.
  }
  return undefined;
};

const auditContracts = (
  contracts: ReadonlyArray<ContractExpectation>,
  impacts: ReadonlyArray<UpdateImpact | undefined>,
): {
  readonly audit: ReadonlyArray<ContractAuditEntry>;
  readonly mismatch: ContractMismatch | undefined;
} => {
  const audit: Array<ContractAuditEntry> = [];
  let mismatch: ContractMismatch | undefined;
  for (const c of contracts) {
    const serviceKey = c.tag.key;
    const observedTo = schemaVersionFromTag(c.tag);
    const observedFrom = observedFromInImpacts(serviceKey, impacts);
    let ok = true;
    let reason: ContractAuditEntry["reason"];

    if (c.to !== undefined && observedTo !== c.to) {
      ok = false;
      reason = "to";
    } else if (c.from !== undefined) {
      if (observedFrom !== undefined && observedFrom !== c.from) {
        ok = false;
        reason = "from";
      } else if (observedFrom === undefined && c.to !== undefined) {
        // No gap reported — verify Versioned path from→to when schemas allow.
        const item = itemSchemaOf(c.tag);
        if (
          item !== undefined &&
          Versioned.isVersioned(item) &&
          c.from !== c.to &&
          !versionInChain(item, c.from)
        ) {
          ok = false;
          reason = "path";
        }
      }
    }

    const entry: ContractAuditEntry = {
      serviceKey,
      expected: { from: c.from, to: c.to },
      observed: { from: observedFrom, to: observedTo },
      ok,
      reason,
    };
    audit.push(entry);
    if (!ok && mismatch === undefined && reason !== undefined) {
      mismatch = new ContractMismatch({
        serviceKey,
        expected: entry.expected,
        observed: entry.observed,
        reason,
      });
    }
  }
  return { audit, mismatch };
};

type PlanError = EmptyUpdatePlan | UpdateBlocked | UpdateTargetUnknown | ContractMismatch;

type ExecuteError =
  | UpdatePlanBlocked
  | UpdateBlocked
  | UpdateTargetUnknown
  | LookupNotRunning
  | LookupAddressRequired
  | NodeAlreadyUp
  | ReadyTimedOut
  | ChildExited
  | HandleSpent
  | HandleNotReady
  | AssumeTokenMismatch
  | AssumeTokenReused
  | AssumeNotReady
  | NodeUnreachable
  | ProtocolUnanswered
  | ServiceNotReady
  | ServiceNotServed
  | UnaddressedNode
  | HandoffDeferred
  | PlatformError
  | ConfigError;

type ExecuteEnv =
  | Directory.Service
  | Advice.Service
  | Dialers.Service
  | ChildProcessSpawner.ChildProcessSpawner
  | Scope.Scope;

// =============================================================================
// Public API
// =============================================================================

/**
 * Compose an inspectable {@link UpdatePlan}: run {@link planUpdate} per step
 * (in order), audit optional contracts, fail closed on blockers / mismatches.
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
  input: PlanInput,
): Effect.Effect<
  UpdatePlan,
  PlanError,
  Directory.Service | Advice.Service | Dialers.Service
> =>
  Effect.gen(function* () {
    if (input.steps.length === 0) {
      return yield* new EmptyUpdatePlan();
    }

    const planned: Array<PlannedStep> = [];
    for (let i = 0; i < input.steps.length; i++) {
      const step = input.steps[i]!;
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
        order: i,
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

    const blocked =
      planned.some((s) => s.impact?.blocked === true) ||
      audit.some((a) => !a.ok);

    const result: UpdatePlan = {
      _tag: "UpdatePlan",
      steps: planned,
      contracts,
      audit,
      blocked,
    };

    if (blocked && input.force !== true) {
      // Per-step planUpdate already threw UpdateBlocked when ambient fail-closed.
      // Reach here when force collected blocked impacts, or audit-only block.
      if (audit.some((a) => !a.ok)) {
        const bad = audit.find((a) => !a.ok)!;
        return yield* new ContractMismatch({
          serviceKey: bad.serviceKey,
          expected: bad.expected,
          observed: bad.observed,
          reason: bad.reason ?? "to",
        });
      }
    }

    return result;
  });

/**
 * Validate an {@link UpdatePlan} without spawning — re-checks contract audit and
 * blocked flags. For a full production-like mock: boot Lookup + incumbents, then
 * `plan` → `simulate` → `execute` (see guide / dream-redeploy suite).
 *
 * @category constructors
 * @public
 */
export const simulate = (
  updatePlan: UpdatePlan,
): Effect.Effect<SimulateReport, UpdatePlanBlocked | ContractMismatch> =>
  Effect.gen(function* () {
    const { audit, mismatch } = auditContracts(
      updatePlan.contracts,
      updatePlan.steps.map((s) => s.impact),
    );
    if (mismatch !== undefined) {
      return yield* mismatch;
    }
    const blocked =
      updatePlan.steps.some((s) => s.impact?.blocked === true) ||
      audit.some((a) => !a.ok);
    const report: SimulateReport = {
      plan: { ...updatePlan, audit, blocked },
      ok: !blocked,
      audit,
    };
    if (blocked) {
      return yield* new UpdatePlanBlocked({ plan: report.plan });
    }
    return report;
  });

/**
 * Execute a validated {@link UpdatePlan} — ordered steps, each via
 * {@link restartSuccessor} with `skipPlan: true`.
 *
 * Fails with {@link UpdatePlanBlocked} if `plan.blocked` (call {@link simulate}
 * first, or pass a plan built with `force: true` only when you intend to proceed).
 *
 * @category constructors
 * @public
 */
export const execute = (
  updatePlan: UpdatePlan,
): Effect.Effect<
  ReadonlyArray<UpdateImpact | undefined>,
  ExecuteError,
  ExecuteEnv
> =>
  Effect.gen(function* () {
    if (updatePlan.blocked) {
      return yield* new UpdatePlanBlocked({ plan: updatePlan });
    }
    const impacts: Array<UpdateImpact | undefined> = [];
    for (const step of updatePlan.steps) {
      const impact = yield* restartSuccessor({
        target: step.target,
        successor: step.successor,
        tags: step.tags,
        skipPlan: true,
        ...(step.incumbent !== undefined ? { incumbent: step.incumbent } : {}),
        ...(step.prefer !== undefined ? { prefer: step.prefer } : {}),
        ...(step.force !== undefined ? { force: step.force } : {}),
        ...(step.status !== undefined ? { status: step.status } : {}),
      });
      impacts.push(impact ?? step.impact);
    }
    return impacts;
  });

/**
 * Type guard for {@link UpdatePlan}.
 *
 * @category refinements
 * @public
 */
export const isPlan = (u: unknown): u is UpdatePlan => {
  if (typeof u !== "object" || u === null || !("_tag" in u)) {
    return false;
  }
  return u._tag === "UpdatePlan";
};
