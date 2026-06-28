import { Context } from "effect";
import { expect, it } from "vitest";
import { Group } from "../src/Group";

// minimal leaf tags — any Context tag works as a member.
class Counter extends Context.Service<Counter, { readonly n: number }>()(
  "@nikscripts/effect-pm/test/group.test/Counter",
) {}
class Jobs extends Context.Service<Jobs, { readonly run: () => void }>()(
  "@nikscripts/effect-pm/test/group.test/Jobs",
) {}

class Inner extends Group.Tag<Inner>(
  "@nikscripts/effect-pm/test/group.test/Inner",
)({
  Counter,
}) {}

class Outer extends Group.Tag<Outer>(
  "@nikscripts/effect-pm/test/group.test/Outer",
)({
  Jobs,
  Inner, // a child group — nesting is free
}) {}

it("members become accessors with names intact", () => {
  expect(Outer.Jobs).toBe(Jobs);
  expect(Outer.Inner).toBe(Inner);
  expect(Inner.Counter).toBe(Counter);
});

it("exposes the members record (directly and via the namespace)", () => {
  expect(Outer.members).toEqual({ Jobs, Inner });
  expect(Group.members(Outer)).toBe(Outer.members);
});

it("nests: reach a leaf through a child group, name preserved", () => {
  expect(Outer.Inner.Counter).toBe(Counter);
  expect(Group.members(Group.members(Outer).Inner)).toEqual({ Counter });
});

it("the group is itself a real Context tag", () => {
  expect(Outer.key).toBe("@nikscripts/effect-pm/test/group.test/Outer");
  // built on Context.Service, so it carries the tag key — usable as a real tag
  expect(Outer.key).toBe("@nikscripts/effect-pm/test/group.test/Outer");
});
