/**
 * @module examples/resource-cli/group
 *
 * `Group.Tag` — a real Context tag (built on `Context.Service`, like `Resource.Tag`)
 * that holds named member tags. Pass a record; each member becomes an accessor on
 * the class, full tag intact.
 *
 *   class MyGroup extends Group.Tag<MyGroup>("@repo/pkg/MyGroup")({
 *     Counter,
 *     QueueManager,
 *   }) {}
 *
 *   MyGroup.Counter         // the Counter tag, name intact
 *   MyGroup.members         // { Counter, QueueManager }
 *   Group.members(MyGroup)  // same, via the namespace
 */

import { Context } from "effect";

export const Group = {
  Tag:
    <Self>(id: string) =>
    <const Members extends Record<string, unknown>>(members: Members) => {
      const base = Context.Service<Self, { readonly members: Members }>()(id);
      // spread the members as accessors (MyGroup.Counter), plus id + the record
      return Object.assign(base, { id, members }, members);
    },

  /** Get the member tags back out (the record). */
  members: <Members extends Record<string, unknown>>(group: {
    readonly members: Members;
  }): Members => group.members,
};
