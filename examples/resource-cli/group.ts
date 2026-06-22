/**
 * @module examples/resource-cli/group
 *
 * `Group.Tag` — a real Context tag (built on `Context.Service`, like `Resource.Tag`)
 * that also holds member tags. Declare it like any tag; get the members back out.
 *
 *   class MyGroup extends Group.Tag<MyGroup>("my-group")([Counter, QueueManager]) {}
 *
 *   MyGroup.id              // "my-group"
 *   MyGroup.members         // [Counter, QueueManager]
 *   Group.members(MyGroup)  // same, via the namespace
 */

import { Context } from "effect";

export const Group = {
  Tag:
    <Self>(id: string) =>
    <const Members extends ReadonlyArray<unknown>>(members: Members) => {
      const base = Context.Service<Self, { readonly members: Members }>()(id);
      return Object.assign(base, { id, members });
    },

  /** Get the member tags back out. */
  members: <Members extends ReadonlyArray<unknown>>(group: {
    readonly members: Members;
  }): Members => group.members,
};
