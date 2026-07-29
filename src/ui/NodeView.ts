/**
 * @module ui/NodeView
 *
 * Node observe surface — NodeRef is not a Hyperlink Tag, so use {@link use} / {@link bind}
 * (not `Observe.use`).
 *
 * @example
 * ```ts
 * import * as NodeView from "hyperlink-ts/ui/NodeView"
 * const box = NodeView.use(ref)
 * ```
 */
import * as React from "react";
import type { NodeBundle, NodeRef } from "./data";
import { nodeBind } from "./familyPacks";
import { useRuntime } from "./runtime";

/**
 * Discharge node status/logs/health under an explicit runtime.
 *
 * @public
 */
export const bind = nodeBind;

/**
 * Discharge node observe under {@link RuntimeProvider}.
 *
 * @public
 */
export const use = (ref: NodeRef): NodeBundle => {
  const runtime = useRuntime();
  return React.useMemo(() => bind(runtime)(ref), [runtime, ref]);
};
