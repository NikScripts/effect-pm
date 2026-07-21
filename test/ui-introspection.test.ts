import { expect, it } from "vitest";
// Import from the package BARREL — exactly what the other repo's UI agent imports.
import { Group, Process, specOf, methodMeta } from "../src";
import * as Node from "../src/Node";

// A dashboard/TUI needs three things from the package, all proven here:
//  1. walk a Group.Tag tree (members + nesting),
//  2. introspect each resource's contract (specOf + methodMeta → kind/description/destructive/streaming),
//  3. drive it over the wire (Resource.client / http — proven in the node/topology tests).
class MiniNode extends Node.Tag<MiniNode>()("ui/miniNode") {}
class Roster extends Process.Tag<Roster>()("ui/Roster") {}
class Poller extends Process.Tag<Poller>()("ui/Poller", { node: MiniNode }) {}
class Nwsl extends Group.Tag<Nwsl>("ui/Nwsl")({ Roster, Poller }) {}
class Hub extends Group.Tag<Hub>("ui/Hub")({ Nwsl }) {}

// the UI writes its OWN traversal — the package exposes members + the Group.isGroup discriminator
// (note: tags are classes, so a naive `typeof === "object"` check would wrongly treat a subgroup
// as a leaf; Group.isGroup handles that).
const leafPaths = (
  members: Record<string, unknown>,
  prefix: ReadonlyArray<string> = [],
): ReadonlyArray<string> => {
  const out: Array<string> = [];
  for (const [name, member] of Object.entries(members)) {
    if (Group.isGroup(member)) {
      out.push(...leafPaths(member.members, [...prefix, name]));
    } else {
      out.push([...prefix, name].join("/"));
    }
  }
  return out;
};

it("a UI can walk a nested group tree to enumerate resources", () => {
  expect([...leafPaths(Group.members(Hub))].sort()).toEqual([
    "Nwsl/Poller",
    "Nwsl/Roster",
  ]);
});

it("a UI can introspect each resource's contract to render widgets", () => {
  for (const tag of [Roster, Poller]) {
    const methods = Object.entries(specOf(tag)).map(([name, method]) => ({
      name,
      ...methodMeta(method),
    }));
    // live panel, read panel, and a confirm-before button all fall out of the metadata
    expect(methods.some((m) => m.name === "status" && m.streaming)).toBe(true);
    expect(methods.some((m) => m.name === "run")).toBe(true);
    expect(methods.some((m) => m.name === "stop" && m.destructive)).toBe(true);
    // every method carries a human-readable description for the UI
    expect(methods.every((m) => typeof m.description === "string")).toBe(true);
  }
});
