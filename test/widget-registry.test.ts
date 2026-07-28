import { HashMap } from "effect";
import { expect, it } from "vitest";
import { kind as queueKind } from "../src/WorkPool";
import { kind as daemonKind } from "../src/Daemon";
import { leafMemberKinds, wireKindOf } from "../src/ui/memberKind";
import {
  emptyRegistry,
  forKey,
  forKind,
  isLeafTag,
  widgetFor,
  withEntries,
  type WidgetRegistry,
} from "../src/ui/widgetRegistry";
import { base as tuiBase } from "../src/tui/cellWidgets";
import { base as webBase } from "../src/web/widgets";

// Distinct widgets, compared by reference identity (widgetFor returns the stored one).
const Box = (label: string): string => label;

const empty = (fallback: string): WidgetRegistry<string> => emptyRegistry(fallback);

it("resolves key → stamped kind → fallback, in that order", () => {
  const q = Box("queue-widget");
  const special = Box("special");
  const fb = Box("fallback");
  const reg = withEntries(empty(fb), [forKind(queueKind, q), forKey("app/One", special)]);

  expect(widgetFor(reg, "app/One", queueKind)).toBe(special); // exact key beats its kind
  expect(widgetFor(reg, "app/Two", queueKind)).toBe(q); // no key → kind
  expect(widgetFor(reg, "app/Two", "mystery")).toBe(fb); // neither → fallback
});

it("withEntries extends the base and overrides only the matching entry", () => {
  const q = Box("queue-widget");
  const p = Box("daemon-widget");
  const base = withEntries(empty(Box("fb")), [forKind(queueKind, q), forKind(daemonKind, p)]);

  const q2 = Box("queue-v2");
  const extended = withEntries(base, [forKind(queueKind, q2)]);

  expect(widgetFor(extended, "x", queueKind)).toBe(q2); // overridden
  expect(widgetFor(extended, "x", daemonKind)).toBe(p); // base entry intact
});

it("isLeafTag accepts a keyed tag, rejects groups and non-tags", () => {
  expect(isLeafTag({ key: "app/Q" })).toBe(true);
  expect(isLeafTag({ members: {} })).toBe(false); // a group has no `key`
  expect(isLeafTag(null)).toBe(false);
  expect(isLeafTag("app/Q")).toBe(false);
  expect(isLeafTag({ key: 42 })).toBe(false); // key must be a string
});

it("web base registry covers every leaf MemberKind wire stamp", () => {
  for (const leaf of leafMemberKinds) {
    expect(HashMap.has(webBase.byKind, wireKindOf[leaf])).toBe(true);
  }
});

it("tui base registry covers every leaf MemberKind wire stamp", () => {
  for (const leaf of leafMemberKinds) {
    expect(HashMap.has(tuiBase.byKind, wireKindOf[leaf])).toBe(true);
  }
});
