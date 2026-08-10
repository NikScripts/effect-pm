/**
 * Lookup update-impact planner — dry-run before spawn / A→B.
 *
 * Membership + impact query only (Lookup plane). Prefer fleet
 * `Update.plan` → `simulate` → `execute` for multi-node cutovers; this remains
 * the per-step impact brain. `clientsAtRisk` reads live {@link Dialers}
 * sessions (Advice-prefer proxy when the census is empty). `liveTips` records
 * status `schemaVersion` rows for Update contract `from` audit.
 *
 * @module internal/lookupPlanUpdate
 * @internal
 */
import {
  Context,
  Data,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
} from "effect";
import * as Advice from "../Advice";
import * as Dialers from "../Dialers";
import * as Directory from "../Directory";
import * as Identity from "../Identity";
import * as Hyperlink from "../Hyperlink";
import { isWireSpecLeaf, kindOf, specSym, wireKeySym } from "../Hyperlink";
import type { FlatSpec } from "../Hyperlink";
import * as LookupPolicy from "../LookupPolicy";
import * as Versioned from "../Versioned";
import { hashContract } from "./contractHash";
import { Service as NodeTag } from "./nodeCore";
import {
  itemSchemaOf,
  schemaVersionFromTag,
  versionInChain,
} from "./versioned";

/**
 * Minimal tag shape {@link planUpdate} needs — key + flat Spec + F4 hash inputs.
 *
 * @category models
 * @public
 */
export type PlanUpdateTag = {
  readonly key: string;
  readonly [wireKeySym]: string;
  readonly [specSym]: FlatSpec;
};

// =============================================================================
// Models
// =============================================================================

/**
 * Dry-run impact of replacing {@link UpdateImpact.target} with a successor Tag bundle.
 *
 * @category models
 * @public
 */
export interface UpdateImpact {
  /** Directory `nodeKey` being replaced. */
  readonly target: string;
  /** HyperService keys the target currently advertises. */
  readonly served: ReadonlyArray<string>;
  /** Other Directory nodes that serve an overlapping key (same-identity roll set). */
  readonly coUpdate: ReadonlyArray<string>;
  /**
   * Live dial sessions targeting `target` ({@link Dialers.listForTarget}).
   * Falls back to Advice-prefer proxy when the census is empty.
   */
  readonly clientsAtRisk: ReadonlyArray<{
    readonly dialerId: string;
    readonly serviceKey: string;
    readonly target: string;
  }>;
  /**
   * Target status tip with no Versioned path to the successor tip.
   * Co-update peers are not hard-blockers (fleet rolls schedule them as later steps).
   */
  readonly migrationGaps: ReadonlyArray<{
    readonly serviceKey: string;
    readonly leaf: string;
    readonly from: string;
    readonly to: string;
  }>;
  /**
   * Wire methods on an incumbent Spec absent from the successor (not merely
   * {@link Hyperlink.deprecated}). Requires {@link PlanUpdateOptions.incumbent}.
   */
  readonly wireRemovals: ReadonlyArray<{
    readonly serviceKey: string;
    readonly method: string;
  }>;
  /**
   * Target live status `contractHash` ≠ successor {@link Hyperlink.contractHash}.
   * Peer drifts are omitted so ordered fleet plans are not fail-closed on later steps.
   */
  readonly contractDrifts: ReadonlyArray<{
    readonly node: string;
    readonly serviceKey: string;
    readonly expected: string;
    readonly actual: string | undefined;
  }>;
  /**
   * Live `schemaVersion` rows from status dial (target + coUpdate peers; empty when
   * status is off or peers do not answer). Update contract `from` audits the
   * **target** row only.
   */
  readonly liveTips: ReadonlyArray<{
    readonly node: string;
    readonly serviceKey: string;
    readonly schemaVersion: string | undefined;
  }>;
  /** Target advertises Lookup Identity/Directory/Advice — sequence Lookup A/B first. */
  readonly lookupFirst: boolean;
  /**
   * True when hard signals are present on the **target** (gaps, removals, or
   * contract drifts). Peer status never sets this.
   */
  readonly blocked: boolean;
}

/**
 * Options for {@link planUpdate}.
 *
 * @category models
 * @public
 */
export interface PlanUpdateOptions {
  /**
   * When `true`, return the impact even if {@link UpdateImpact.blocked}.
   * Overrides ambient {@link PlanForce}. Default ambient `false` (fail closed).
   */
  readonly force?: boolean;
  /**
   * Local Specs for the tip being replaced — enables {@link UpdateImpact.wireRemovals}
   * (live peers only expose hashes, not method lists).
   */
  readonly incumbent?: ReadonlyArray<PlanUpdateTag>;
  /**
   * Dial peer node-status for `contractHash` / `schemaVersion`.
   * Overrides ambient {@link PlanStatus}. Default ambient `true`.
   * Set ambient/off for Directory-only dry-runs or TestClock.
   */
  readonly status?: boolean;
}

/**
 * Ambient fail-closed vs force for {@link planUpdate}. Default `false`.
 *
 * @category references
 * @public
 */
export const PlanForce: Context.Reference<boolean> = Context.Reference<boolean>(
  "hyperlink-ts/Lookup/PlanForce",
  { defaultValue: (): boolean => false },
);

/**
 * Ambient status-dial for {@link planUpdate}. Default `true`.
 *
 * @category references
 * @public
 */
export const PlanStatus: Context.Reference<boolean> =
  Context.Reference<boolean>("hyperlink-ts/Lookup/PlanStatus", {
    defaultValue: (): boolean => true,
  });

/** Fail closed on blockers (default). @category layers @public */
export const planFailClosed: Layer.Layer<never> = Layer.succeed(PlanForce, false);

/** Return blocked impact instead of {@link UpdateBlocked}. @category layers @public */
export const planForce: Layer.Layer<never> = Layer.succeed(PlanForce, true);

/** Dial peer status (default). @category layers @public */
export const planStatusOn: Layer.Layer<never> = Layer.succeed(PlanStatus, true);

/** Skip status dials (Directory/Advice only / TestClock). @category layers @public */
export const planStatusOff: Layer.Layer<never> = Layer.succeed(PlanStatus, false);

/**
 * Target `nodeKey` is not advertised under any successor HyperService key.
 *
 * @category errors
 * @public
 */
export class UpdateTargetUnknown extends Data.TaggedError(
  "UpdateTargetUnknown",
)<{
  readonly target: string;
}> {
  override get message() {
    return `Lookup.planUpdate: target "${this.target}" is not advertised in Directory.`;
  }
}

/**
 * Impact has hard blockers and {@link PlanUpdateOptions.force} was not set.
 *
 * @category errors
 * @public
 */
export class UpdateBlocked extends Data.TaggedError("UpdateBlocked")<{
  readonly impact: UpdateImpact;
}> {
  override get message() {
    return `Lookup.planUpdate blocked for target "${this.impact.target}".`;
  }
}

// =============================================================================
// Helpers
// =============================================================================

const LOOKUP_SERVICE_KEYS = new Set([
  Identity.Service.key,
  Directory.Service.key,
  Advice.Service.key,
  Dialers.Service.key,
]);

/** Wire method path keys still on the Spec (includes deprecated — still on the wire). */
const wireMethodKeys = (tag: PlanUpdateTag): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const [path, leaf] of Object.entries(tag[specSym])) {
    if (isWireSpecLeaf(leaf)) keys.add(path);
  }
  return keys;
};

const contractHashOf = (tag: PlanUpdateTag): string =>
  hashContract(tag[wireKeySym], kindOf(tag) ?? "hyperlink", tag[specSym]);

/**
 * Resolve a Directory row for `target` by walking successor tags (any match).
 * Shared by {@link planUpdate} and {@link Launcher.restartSuccessor} so execute
 * does not only seed on `tags[0]`.
 *
 * @internal
 */
export const findTargetEntry = (
  target: string,
  successor: ReadonlyArray<PlanUpdateTag>,
): Effect.Effect<
  Directory.DirectoryEntry,
  UpdateTargetUnknown,
  Directory.Service
> =>
  Effect.gen(function* () {
    for (const tag of successor) {
      const rows = yield* Directory.nodesServing(tag);
      const hit = rows.find((row) => row.nodeKey === target);
      if (hit !== undefined) return hit;
    }
    return yield* new UpdateTargetUnknown({ target });
  });

type StatusSnap = {
  readonly node: string;
  readonly services: ReadonlyArray<{
    readonly key: string;
    readonly contractHash: string | undefined;
    readonly schemaVersion: string | undefined;
  }>;
};

const dialStatus = (
  entry: Directory.DirectoryEntry,
): Effect.Effect<Option.Option<StatusSnap>> => {
  const target =
    entry.kind === "IpcSocket" && entry.path !== undefined
      ? NodeTag()(`hyperlink-ts/lookup-plan/${entry.nodeKey}`, {
          path: entry.path,
        })
      : entry.url !== undefined
        ? NodeTag()(`hyperlink-ts/lookup-plan/${entry.nodeKey}`, {
            url: entry.url,
            kind: entry.kind,
          })
        : undefined;
  if (target === undefined) {
    return Effect.succeed(Option.none());
  }
  // Short wall — dry-run should not stall on unreachable dials.
  const probe = Effect.gen(function* () {
    const { NodeStatusTag } = yield* Effect.promise(
      () => import("./nodeStatus"),
    );
    const ctx = yield* Layer.build(
      Hyperlink.client(NodeStatusTag, target).pipe(
        LookupPolicy.provide(LookupPolicy.verifyOff),
      ),
    );
    const snap = yield* Effect.gen(function* () {
      const status = yield* NodeStatusTag;
      return yield* status.status.get;
    }).pipe(Effect.provide(ctx));
    return {
      node: entry.nodeKey,
      services: snap.services.map((row) => ({
        key: row.key,
        contractHash: row.contractHash,
        schemaVersion: row.schemaVersion,
      })),
    } satisfies StatusSnap;
  }).pipe(Effect.scoped, Effect.timeout(Duration.millis(250)));
  return Effect.map(Effect.exit(probe), (exit) =>
    Exit.isSuccess(exit) ? Option.some(exit.value) : Option.none(),
  );
};

const migrationGapsFor = (
  serviceKey: string,
  from: string | undefined,
  successorTag: PlanUpdateTag,
): ReadonlyArray<UpdateImpact["migrationGaps"][number]> => {
  if (from === undefined) return [];
  if (schemaVersionFromTag(successorTag) === undefined) return [];
  const item = itemSchemaOf(successorTag);
  if (!Versioned.isVersioned(item)) return [];
  const to = Versioned.schemaVersion(item);
  if (from === to || versionInChain(item, from)) return [];
  return [{ serviceKey, leaf: "payload", from, to }];
};

const wireRemovalsFor = (
  incumbent: ReadonlyArray<PlanUpdateTag> | undefined,
  successorByKey: Map<string, PlanUpdateTag>,
): ReadonlyArray<UpdateImpact["wireRemovals"][number]> => {
  if (incumbent === undefined) return [];
  const out: Array<UpdateImpact["wireRemovals"][number]> = [];
  for (const oldTag of incumbent) {
    const next = successorByKey.get(oldTag.key);
    if (next === undefined) continue;
    const nextKeys = wireMethodKeys(next);
    for (const method of wireMethodKeys(oldTag)) {
      if (!nextKeys.has(method)) {
        out.push({ serviceKey: oldTag.key, method });
      }
    }
  }
  return out;
};

// =============================================================================
// Public constructor
// =============================================================================

/**
 * Dry-run update impact for replacing Directory `target` with `successor` Tags.
 *
 * Finds the target via {@link Directory.nodesServing} on successor keys (at least one
 * overlap required). Compares live status hashes / `schemaVersion` when peers answer;
 * Spec method removals need {@link PlanUpdateOptions.incumbent}.
 *
 * Fail-closed: {@link UpdateBlocked} when {@link UpdateImpact.blocked} unless
 * `{ force: true }`. Does **not** spawn — compose with {@link Update.plan} /
 * {@link Update.execute} (or {@link Launcher.restartSuccessor} for one step).
 *
 * @category constructors
 * @public
 */
export const planUpdate = (
  target: string,
  successor: ReadonlyArray<PlanUpdateTag>,
  options?: PlanUpdateOptions,
): Effect.Effect<
  UpdateImpact,
  UpdateBlocked | UpdateTargetUnknown,
  Directory.Service | Advice.Service | Dialers.Service
> =>
  Effect.gen(function* () {
    const entry = yield* findTargetEntry(target, successor);
    const served = [...entry.serves];
    const byKey = new Map(successor.map((tag) => [tag.key, tag] as const));
    const force = options?.force ?? (yield* PlanForce);
    const dialStatusEnabled = options?.status ?? (yield* PlanStatus);

    const coUpdateSet = new Set<string>();
    const peerEntries = new Map<string, Directory.DirectoryEntry>();
    peerEntries.set(entry.nodeKey, entry);
    for (const key of served) {
      const rows = yield* Directory.nodesServing(key);
      for (const row of rows) {
        peerEntries.set(row.nodeKey, row);
        if (row.nodeKey !== target) coUpdateSet.add(row.nodeKey);
      }
    }
    const coUpdate = [...coUpdateSet].sort();

    const live = yield* Dialers.listForTarget(target);
    const clientsAtRisk: Array<UpdateImpact["clientsAtRisk"][number]> = [];
    if (live.length > 0) {
      for (const row of live) {
        clientsAtRisk.push({
          dialerId: row.dialerId,
          serviceKey: row.serviceKey,
          target: row.target,
        });
      }
    } else {
      // Soft fallback — Advice prefer still signals placement risk when
      // no lookupClient / peersLayer has registered yet.
      for (const key of served) {
        const prefer = yield* Advice.preferred(key);
        if (Option.isSome(prefer) && prefer.value === target) {
          clientsAtRisk.push({
            dialerId: `advice:${key}`,
            serviceKey: key,
            target,
          });
        }
      }
    }

    const migrationGaps: Array<UpdateImpact["migrationGaps"][number]> = [];
    const contractDrifts: Array<UpdateImpact["contractDrifts"][number]> = [];
    const liveTips: Array<UpdateImpact["liveTips"][number]> = [];

    if (dialStatusEnabled) {
      for (const peer of peerEntries.values()) {
        const snapOpt = yield* dialStatus(peer);
        if (Option.isNone(snapOpt)) continue;
        const snap = snapOpt.value;
        const isTarget = snap.node === target;
        for (const row of snap.services) {
          const next = byKey.get(row.key);
          if (next === undefined) continue;
          liveTips.push({
            node: snap.node,
            serviceKey: row.key,
            schemaVersion: row.schemaVersion,
          });
          // Hard blockers are target-scoped — coUpdate peers stay advisory so
          // ordered fleet plans (A then B) are not fail-closed on B's old tip.
          if (!isTarget) continue;
          const expected = contractHashOf(next);
          if (row.contractHash !== expected) {
            contractDrifts.push({
              node: snap.node,
              serviceKey: row.key,
              expected,
              actual: row.contractHash,
            });
          }
          for (const gap of migrationGapsFor(
            row.key,
            row.schemaVersion,
            next,
          )) {
            migrationGaps.push(gap);
          }
        }
      }
    }

    const wireRemovals = wireRemovalsFor(options?.incumbent, byKey);
    const lookupFirst = served.some((key) => LOOKUP_SERVICE_KEYS.has(key));
    const blocked =
      migrationGaps.length > 0 ||
      wireRemovals.length > 0 ||
      contractDrifts.length > 0;

    const impact = {
      target,
      served,
      coUpdate,
      clientsAtRisk,
      migrationGaps,
      wireRemovals,
      contractDrifts,
      liveTips,
      lookupFirst,
      blocked,
    } satisfies UpdateImpact;

    if (blocked && force !== true) {
      return yield* new UpdateBlocked({ impact });
    }
    return impact;
  });
