/** Maps public queue priority to a lane level index. @internal */
export type PriorityToLevel = (
  priority: "high" | "normal" | "low",
) => number;

/** Default 3-level mapping: high=0, normal=1, low=2. @internal */
export const defaultPriorityToLevel: PriorityToLevel = (priority) =>
  priority === "high" ? 0 : priority === "low" ? 2 : 1;

/** Inverse of {@link defaultPriorityToLevel} for metrics/events on the default queue. @internal */
export const levelToDefaultPriority = (
  level: number,
): "high" | "normal" | "low" =>
  level === 0 ? "high" : level === 2 ? "low" : "normal";
