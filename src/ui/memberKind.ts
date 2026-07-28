/**
 * @module ui/memberKind
 *
 * Classify a Group member for dashboard dispatch — shared by `hyperlink-ts/web` and
 * `hyperlink-ts/tui` so kind coverage can't drift. Leaf buckets are **stamped Hyperlink
 * kinds** (`WorkPool.kind`, …) — never short costumes like `"queue"` / `"pool"`.
 */
import * as Group from "../Group";
import { kind as hyperlinkKind, kindOf } from "../Hyperlink";
import { kind as queueKind, priorityKind } from "../WorkPool";
import { kind as daemonKind } from "../Daemon";
import { httpApiClientKind as apiKind } from "../Gate";
import { kind as fleetHealthKind } from "../FleetHealth";
import { kind as telemetryKind } from "../Telemetry";
import { kind as shardMapKind } from "../ShardMap";
import { kind as gateKind } from "../Gate";

/** Kind bucket for a group member (subgroup or HyperService leaf). @public */
export type MemberKind =
  | "group"
  | typeof queueKind
  | typeof priorityKind
  | typeof daemonKind
  | typeof apiKind
  | typeof fleetHealthKind
  | typeof telemetryKind
  | typeof shardMapKind
  | typeof gateKind
  | "unknown";

/** Leaf buckets that have dedicated dashboard chrome (excludes `group` / `unknown`). @public */
export type LeafMemberKind = Exclude<MemberKind, "group" | "unknown">;

/** Stable list of leaf stamped kinds — coverage checks iterate this. @public */
export const leafMemberKinds = [
  queueKind,
  priorityKind,
  daemonKind,
  apiKind,
  fleetHealthKind,
  telemetryKind,
  shardMapKind,
  gateKind,
] as const satisfies ReadonlyArray<LeafMemberKind>;

/**
 * Identity map: leaf MemberKind **is** the stamped wire kind.
 * Kept so coverage/tests can write `wireKindOf[leaf]` without a second table.
 *
 * @public
 */
export const wireKindOf: { readonly [K in LeafMemberKind]: K } = {
  [queueKind]: queueKind,
  [priorityKind]: priorityKind,
  [daemonKind]: daemonKind,
  [apiKind]: apiKind,
  [fleetHealthKind]: fleetHealthKind,
  [telemetryKind]: telemetryKind,
  [shardMapKind]: shardMapKind,
  [gateKind]: gateKind,
};

/** Bare {@link Hyperlink.kind} — unknown leaves often stamp this. @public */
export const unknownWireKind = hyperlinkKind;

const leafSet: ReadonlySet<string> = new Set(leafMemberKinds);

/**
 * Discriminate a Group member for widget/cell dispatch.
 *
 * @public
 */
export const memberKindOf = (member: unknown): MemberKind => {
  if (Group.isGroup(member)) return "group";
  const stamped = kindOf(member);
  if (typeof stamped === "string" && leafSet.has(stamped)) {
    return stamped as LeafMemberKind;
  }
  return "unknown";
};
