/**
 * Maps lane-level occupancy to public queue observe shapes. Default projection is the classic
 * `{ high, normal, low }` trio; priority queues use a `Record<string, number>`.
 *
 * @internal
 */
import type { QueueStatus } from "./workPool";
import { defaultPriorityToLevel, type PriorityToLevel } from "./priorityMapping";

/** Inputs for {@link QueueRuntimeProjection.buildStatus}. @internal */
export interface QueueStatusContext {
  readonly levels: ReadonlyArray<number>;
  readonly paused: boolean;
  readonly inFlight: number;
  readonly completed: number;
  readonly phase: QueueStatus["phase"];
}

/** @internal */
export interface QueueRuntimeProjection<Sizes, Status = QueueStatus> {
  readonly priorityToLevel: PriorityToLevel;
  readonly levelToPriority: (level: number) => "high" | "normal" | "low";
  readonly projectSizes: (levels: ReadonlyArray<number>) => Sizes;
  readonly totalPending: (levels: ReadonlyArray<number>) => number;
  readonly isEmptyLevels: (levels: ReadonlyArray<number>) => boolean;
  readonly buildStatus: (ctx: QueueStatusContext) => Status;
}

/** Default 3-level `{ high, normal, low }` projection. @internal */
export const defaultQueueProjection: QueueRuntimeProjection<{
  readonly high: number;
  readonly normal: number;
  readonly low: number;
}> = {
  priorityToLevel: defaultPriorityToLevel,
  levelToPriority: (level) =>
    level === 0 ? "high" : level === 2 ? "low" : "normal",
  projectSizes: (levels) => ({
    high: Math.max(0, levels[0] ?? 0),
    normal: Math.max(0, levels[1] ?? 0),
    low: Math.max(0, levels[2] ?? 0),
  }),
  totalPending: (levels) =>
    levels.reduce((sum, n) => sum + Math.max(0, n), 0),
  isEmptyLevels: (levels) => levels.every((n) => n <= 0),
  buildStatus: (ctx) => ({
    sizes: defaultQueueProjection.projectSizes(ctx.levels),
    paused: ctx.paused,
    inFlight: ctx.inFlight,
    completed: ctx.completed,
    phase: ctx.phase,
  }),
};

/** Build a name → level index registry with numeric fallbacks. @internal */
export const buildLevelIndexLabels = (
  laneCount: number,
  namedLanes: Readonly<Record<string, number>>,
): ReadonlyArray<string> => {
  const labels = Array.from({ length: laneCount }, (_, i) => String(i));
  for (const [name, level] of Object.entries(namedLanes)) {
    if (level >= 0 && level < laneCount) labels[level] = name;
  }
  return labels;
};

/**
 * Priority-queue status snapshot (Record sizes).
 *
 * @category models
 * @public
 */
export interface WorkPoolPriorityStatus {
  readonly sizes: Record<string, number>;
  readonly paused: boolean;
  readonly inFlight: number;
  readonly completed: number;
  readonly phase: QueueStatus["phase"];
}

/**
 * Priority-queue projection: per-level counts keyed by configured name (or `"0"`, `"1"`, …).
 *
 * @internal
 */
export const buildPriorityProjection = (options: {
  readonly laneCount: number;
  readonly namedLanes?: Readonly<Record<string, number>>;
}): QueueRuntimeProjection<Record<string, number>, WorkPoolPriorityStatus> => {
  const laneCount = Math.max(1, Math.floor(options.laneCount));
  const labels = buildLevelIndexLabels(laneCount, options.namedLanes ?? {});

  const projectSizes = (levels: ReadonlyArray<number>): Record<string, number> => {
    const out: Record<string, number> = {};
    // Every configured lane, always — an empty lane reports 0 (not omitted), so `sizes` is a stable
    // key set (a consumer's per-lane view doesn't reflow when a lane drains), matching the default
    // high/normal/low projection which always reports all three.
    for (let i = 0; i < laneCount; i++) {
      out[labels[i] ?? String(i)] = Math.max(0, levels[i] ?? 0);
    }
    return out;
  };

  return {
    priorityToLevel: defaultPriorityToLevel,
    levelToPriority: (level) =>
      level === 0 ? "high" : level === 2 ? "low" : "normal",
    projectSizes,
    totalPending: (levels) =>
      levels.slice(0, laneCount).reduce((sum, n) => sum + Math.max(0, n), 0),
    isEmptyLevels: (levels) =>
      levels.slice(0, laneCount).every((n) => n <= 0),
    buildStatus: (ctx) => ({
      sizes: projectSizes(ctx.levels),
      paused: ctx.paused,
      inFlight: ctx.inFlight,
      completed: ctx.completed,
      phase: ctx.phase,
    }),
  };
};
