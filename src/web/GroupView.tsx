/**
 * @module web/GroupView
 *
 * Walks a `Group` tree (`Group.members` / `Group.isGroup`) and renders it: each
 * leaf resource through {@link ResourceView} (module-aware), each branch as a
 * {@link GroupCard} you can open (drill-down, with a back trail). Nothing is
 * hard-coded to a particular hub — point it at any `Group.Tag` and it renders.
 *
 * @since 1.0.0
 */
import * as React from "react";
import { Atom } from "effect/unstable/reactivity";
import { Group } from "../Group";
import type { ResourceTag, Spec } from "../Resource";
import { displayName } from "./binding";
import { GroupCard, ResourceView } from "./widgets";
import { useResourceUI } from "./ResourceWidget";

/** A tree node: a group tag or subgroup. @since 1.0.0 */
export interface GroupNode {
  readonly key: string;
  readonly members: Record<string, unknown>;
}

/** One leaf resource — builds its binding and renders the module-aware view. @since 1.0.0 */
export const LeafWidget = <R, ER>(props: {
  readonly runtime: Atom.AtomRuntime<R, ER>;
  readonly member: unknown;
  readonly hostFor?: (id: string) => string | undefined;
}): React.ReactElement => {
  // Boundary: a non-group member of a Group is a resource tag (erased for the walk).
  const tag = props.member as ResourceTag<never, Spec>;
  const ui = useResourceUI(props.runtime, tag);
  return <ResourceView ui={ui} host={props.hostFor?.(ui.key)} />;
};

/** Render the members of one node: branches as openable cards, leaves as widgets. @since 1.0.0 */
const NodeMembers = <R, ER>(props: {
  readonly runtime: Atom.AtomRuntime<R, ER>;
  readonly node: GroupNode;
  readonly onOpen: (node: GroupNode) => void;
  readonly hostFor?: (id: string) => string | undefined;
}): React.ReactElement => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {Object.entries(Group.members(props.node)).map(([name, member]) =>
      Group.isGroup(member) ? (
        <GroupCard
          key={name}
          name={name}
          count={Object.keys(member.members).length}
          onOpen={() => props.onOpen(member)}
        />
      ) : (
        <LeafWidget key={name} runtime={props.runtime} member={member} hostFor={props.hostFor} />
      ),
    )}
  </div>
);

/** The dashboard: a drill-down tree over a root `Group`. @since 1.0.0 */
export const GroupView = <R, ER>(props: {
  readonly runtime: Atom.AtomRuntime<R, ER>;
  readonly group: GroupNode;
  readonly hostFor?: (id: string) => string | undefined;
}): React.ReactElement => {
  const [trail, setTrail] = React.useState<ReadonlyArray<GroupNode>>([props.group]);
  const node = trail[trail.length - 1] ?? props.group;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {trail.map((n, i) => (
          <React.Fragment key={n.key}>
            {i > 0 ? <span className="text-muted-foreground">/</span> : null}
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => setTrail(trail.slice(0, i + 1))}
            >
              {displayName(n.key)}
            </button>
          </React.Fragment>
        ))}
      </div>
      <NodeMembers
        runtime={props.runtime}
        node={node}
        hostFor={props.hostFor}
        onOpen={(child) => setTrail([...trail, child])}
      />
    </div>
  );
};
