/**
 * @module ui/memberKind
 *
 * Classify a Group member for dashboard dispatch — shared by web and TUI so kind coverage
 * can't drift. Returns a discriminant string; renderers map it to their own chrome.
 *
 */
import * as Group from "../Group";
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
