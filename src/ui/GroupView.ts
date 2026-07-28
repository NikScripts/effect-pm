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

const GroupCardProto = View.card.Prototype()({
  spec: groupViewSpec,
});

/** Group grid card — open via {@link ./Navigator}. @public */
export class GroupCard extends GroupCardProto.Tag<GroupCard>()(
  "hyperlink/view/group-card",
) {}

/** @public */
export const layer = View.bind(Group.kind, GroupCard);
