/**
 * @module ui/memberKind
 *
 * Classify a Group member for dashboard dispatch — shared by `hyperlink-ts/web` and
 * `hyperlink-ts/tui` so kind coverage can't drift. Returns a discriminant string; renderers
 * map it to their own chrome. Leaf buckets align 1:1 with stamped Hyperlink kinds
 * (`wireKindOf`) that the web widget registry binds via `forKind`.
 *
 */
import * as Group from "../Group";
import { kind as hyperlinkKind } from "../Hyperlink";
import { kind as queueKind, priorityKind } from "../WorkPool";
import { kind as daemonKind } from "../Daemon";
import { httpApiClientKind as apiKind } from "../Gate";
import { kind as fleetHealthKind } from "../FleetHealth";
import { kind as telemetryKind } from "../Telemetry";
import { kind as shardMapKind } from "../ShardMap";
import { kind as gateKind } from "../Gate";
import {
  isApiTag,
  isDaemonTag,
  isFleetHealthTag,
  isGateTag,
  isPriorityTag,
  isQueueTag,
  isShardMapTag,
  isTelemetryTag,
} from "./data";

/** Kind bucket for a group member (subgroup or HyperService leaf). @public */
export type MemberKind =
  | "group"
  | "queue"
  | "priority"
  | "daemon"
  | "api"
  | "fleetHealth"
  | "telemetry"
  | "shardMap"
  | "gate"
  | "unknown";

/** Leaf buckets that have dedicated dashboard chrome (excludes `group` / `unknown`). @public */
export type LeafMemberKind = Exclude<MemberKind, "group" | "unknown">;

/** Stable list of leaf {@link MemberKind}s — coverage checks iterate this. @public */
export const leafMemberKinds = [
  "queue",
  "priority",
  "daemon",
  "api",
  "fleetHealth",
  "telemetry",
  "shardMap",
  "gate",
] as const satisfies ReadonlyArray<LeafMemberKind>;

/**
 * Stamped Hyperlink kind string for each leaf {@link MemberKind}.
 * Same strings the web registry registers with `forKind(...)`.
 *
 * @public
 */
export const wireKindOf: { readonly [K in LeafMemberKind]: string } = {
  queue: queueKind,
  priority: priorityKind,
  daemon: daemonKind,
  api: apiKind,
  fleetHealth: fleetHealthKind,
  telemetry: telemetryKind,
  shardMap: shardMapKind,
  gate: gateKind,
};

/** Bare {@link Hyperlink.kind} — unknown leaves often stamp this. @public */
export const unknownWireKind = hyperlinkKind;

/**
 * Discriminate a Group member for widget/cell dispatch.
 *
 * @public
 */
export const memberKindOf = (member: unknown): MemberKind => {
  if (Group.isGroup(member)) return "group";
  if (isQueueTag(member)) return "queue";
  if (isPriorityTag(member)) return "priority";
  if (isDaemonTag(member)) return "daemon";
  if (isApiTag(member)) return "api";
  if (isFleetHealthTag(member)) return "fleetHealth";
  if (isTelemetryTag(member)) return "telemetry";
  if (isShardMapTag(member)) return "shardMap";
  if (isGateTag(member)) return "gate";
  return "unknown";
};
