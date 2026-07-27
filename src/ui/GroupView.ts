/**
 * @module ui/GroupView
 *
 * Shared Group card View handle + contribution Layer — no platform TSX.
 * Group is a family like WorkPool; URL segments stay parent member short names.
 */
import * as Group from "../Group";
import * as View from "./View";

/** @public */
export const groupViewSpec = { kind: Group.kind } as const;

/** Group grid card — open via {@link ./Navigator}. @public */
export const GroupCard = View.make({
  key: "hyperlink/view/group-card",
  kind: "card",
  spec: groupViewSpec,
});

/** @public */
export const layer = View.kind(Group.kind, GroupCard);
