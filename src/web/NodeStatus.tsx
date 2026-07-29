/**
 * @module web/NodeStatus
 *
 * Public **node status** chrome for the web dashboard — die, health board, node detail.
 *
 * Batteries {@link ./DashboardShell} uses **Router pages** (`/health`, `/health/<nodeId>`
 * via `Router.openHealth` / `.openNode`). {@link NodeStatusHost} remains for overlay embeds
 * without a Router.
 *
 * @example
 * ```tsx
 * // Batteries path (URL-backed):
 * nav.openHealth()
 * nav.openNode(node.id)
 *
 * // Overlay embed (no Router):
 * <NodeStatusHost group={ServicesHub}>
 *   {({ openHealth }) => (
 *     <DashboardTopBar
 *       title="Hub"
 *       trailing={<NodeBar group={ServicesHub} onOpen={openHealth} />}
 *     />
 *   )}
 * </NodeStatusHost>
 * ```
 *
 * @public
 */
import * as React from "react";
import { leafByKey, type GroupNode, type NodeRef } from "../ui/data";
import { HealthBoard, NodeBar, NodeDetail } from "./widgets";

export { HealthBoard, NodeBar, NodeDetail };

/**
 * Stack HealthBoard → NodeDetail → optional HyperService detail as fullscreen overlays.
 * When idle, renders `children` with `openHealth`.
 *
 * @public
 */
export const NodeStatusHost = (props: {
  readonly group: GroupNode;
  /**
   * Render a leaf opened from the node axis (wire key → group leaf).
   * Omit to ignore HyperService taps on the board / node detail.
   */
  readonly renderHyperlink?: (
    tag: unknown,
    onBack: () => void,
  ) => React.ReactNode;
  readonly children: (api: {
    readonly openHealth: () => void;
  }) => React.ReactNode;
}): React.ReactElement => {
  const [health, setHealth] = React.useState(false);
  const [node, setNode] = React.useState<NodeRef | null>(null);
  const [nodeTag, setNodeTag] = React.useState<unknown>(null);

  const openHyperlink = React.useCallback(
    (serviceKey: string): void => {
      if (props.renderHyperlink === undefined) return;
      const found = leafByKey(props.group, serviceKey);
      if (found !== undefined) setNodeTag(found);
    },
    [props.group, props.renderHyperlink],
  );

  if (nodeTag !== null && props.renderHyperlink !== undefined) {
    return <>{props.renderHyperlink(nodeTag, () => setNodeTag(null))}</>;
  }
  if (node !== null) {
    return (
      <NodeDetail
        node={node}
        onBack={() => setNode(null)}
        onOpenHyperlink={openHyperlink}
      />
    );
  }
  if (health) {
    return (
      <HealthBoard
        group={props.group}
        onBack={() => setHealth(false)}
        onOpenNode={setNode}
        onOpenHyperlink={openHyperlink}
      />
    );
  }
  return <>{props.children({ openHealth: () => setHealth(true) })}</>;
};
