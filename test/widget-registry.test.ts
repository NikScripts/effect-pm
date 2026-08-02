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

import * as View from "../src/ui/View";
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

it("wireKindOf is identity over every leaf MemberKind", () => {
  expect(leafMemberKinds.length).toBeGreaterThan(0);
  for (const leaf of leafMemberKinds) {
    expect(wireKindOf[leaf]).toBe(leaf);
  }
});

it("web base registry is fallback-only (View.react owns kind chrome)", () => {
  expect(HashMap.size(webBase.byKind)).toBe(0);
  expect(HashMap.size(webBase.byKey)).toBe(0);
  expect(webBase.fallback).toBeTypeOf("function");
});

it("tui base registry is fallback-only (View.react owns kind chrome)", () => {
  expect(HashMap.size(tuiBase.byKind)).toBe(0);
  expect(HashMap.size(tuiBase.byKey)).toBe(0);
  expect(tuiBase.fallback).toBeTypeOf("function");
});
