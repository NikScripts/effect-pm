/**
 * @module Group
 *
 * `Group.Tag` — an organization tool. A real Context tag (built on `Context.Service`,
 * like `Hyperlink.Tag`) that holds named member tags. Pass a record; each member becomes
 * an accessor on the class, full tag intact.
 *
 *   class MyGroup extends Group.Tag<MyGroup>("@pkg/MyGroup")({
 *     Counter,
 *     QueueManager,
 *   }) {}
 *
 *   MyGroup.Counter         // the Counter tag, name intact
 *   MyGroup.members         // { Counter, QueueManager }
 *   Group.members(MyGroup)  // same, via the namespace
 *
 * Groups nest like any other tag: a member can itself be a `Group.Tag`, and because
 * you pass it in under a name, the name is preserved.
 *
 *   class Ops extends Group.Tag<Ops>("@pkg/Ops")({
 *     Web,            // a resource tag
 *     Jobs: MyGroup,  // a child group — nesting is free
 *   }) {}
 *
 *   Ops.Jobs.Counter  // reach into the nested group
 *
 * Consume as a tree-shakeable module namespace: `import * as Group from
 * "hyperlink-ts/Group"` (or `{ Group }` from the barrel).
 *
 * @public
 */

import { Context } from "effect";

/**
 * Stamped family kind for Group tags — View skins bind with `View.bind(Group.kind, …)`.
 *
 * @category constructors
 * @public
 */
export const kind = "hyperlink-ts/Group" as const;

/**
 * Create a group tag holding the given named member tags.
 *
 * @category constructors
 * @public
 */
export const Tag =
  <Self>(key: string) =>
  <const Members extends Record<string, unknown>>(members: Members) => {
    const base = Context.Service<Self, { readonly members: Members }>()(key);
    return Object.assign(base, { members, kind }, members);
  };

/**
 * Get the member tags back out (the record).
 *
 * @category getters
 * @public
 */
export const members = <Members extends Record<string, unknown>>(group: {
  readonly members: Members;
}): Members => group.members;

/**
 * Whether `x` is a group tag (vs a leaf resource tag) — the discriminator for walking a tree.
 * Tags are **classes** (so `typeof` is `"function"`, not `"object"`); a group is one carrying a
 * `members` record. Use it to recurse on branches and treat everything else as a leaf:
 *
 * ```ts
 * for (const [name, member] of Object.entries(Group.members(node)))
 *   Group.isGroup(member) ? walk(member) : renderLeaf(name, member);
 * ```
 *
 * @category guards
 * @public
 */
export const isGroup = (
  x: unknown,
): x is { readonly key: string; readonly members: Record<string, unknown> } =>
  (typeof x === "object" || typeof x === "function") && x !== null && "members" in x;
