/** Maps public queue priority to a lane level index. @internal */
export type PriorityToLevel = (
  priority: "high" | "normal" | "low",
) => number;

/** Default 3-level mapping: high=0, normal=1, low=2. @internal */
export const defaultPriorityToLevel: PriorityToLevel = (priority) =>
  priority === "high" ? 0 : priority === "low" ? 2 : 1;
