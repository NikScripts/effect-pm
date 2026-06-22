/**
 * @module examples/resource-cli/group
 *
 * `Group.Tag` — a class tag that just holds member tags (and nested groups) and
 * hands them back. No control/config machinery; pure organization, usable by any
 * surface (CLI, TUI, …).
 *
 *   class MyGroup extends Group.Tag("my-group")([Counter, QueueManager]) {}
 *
 *   MyGroup.members        // [Counter, QueueManager]
 *   Group.members(MyGroup) // same, via the namespace
 */

export interface GroupTag<
  Members extends ReadonlyArray<unknown> = ReadonlyArray<unknown>,
> {
  readonly id: string;
  readonly members: Members;
}

export const Group = {
  Tag:
    (id: string) =>
    <const Members extends ReadonlyArray<unknown>>(members: Members) => {
      class Base {
        static readonly id = id;
        static readonly members: Members = members;
      }
      return Base;
    },

  /** Get the member tags back out. */
  members: <Members extends ReadonlyArray<unknown>>(
    group: GroupTag<Members>,
  ): Members => group.members,

  /** Is this a group (vs a bare tag / record)? */
  is: (source: object): source is GroupTag => "members" in source,
};
