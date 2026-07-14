import * as React from "react";
import { HashMap } from "effect";
import { expect, it } from "vitest";
import {
  forKey,
  forKind,
  isLeafTag,
  widgetFor,
  withEntries,
  type Widget,
  type WidgetRegistry,
} from "../src/web/widget-registry";

// Distinct widgets, compared by reference identity (widgetFor returns the stored one).
const mk = (label: string): Widget => () => React.createElement("div", null, label);

const empty = (fallback: Widget): WidgetRegistry => ({
  byKey: HashMap.empty<string, Widget>(),
  byKind: HashMap.empty<string, Widget>(),
  fallback,
});

it("resolves key → kind → fallback, in that order", () => {
  const q = mk("queue");
  const special = mk("special");
  const fb = mk("fallback");
  const reg = withEntries(empty(fb), [forKind("queue", q), forKey("app/One", special)]);

  expect(widgetFor(reg, "app/One", "queue")).toBe(special); // exact key beats its kind
  expect(widgetFor(reg, "app/Two", "queue")).toBe(q); // no key → kind
  expect(widgetFor(reg, "app/Two", "mystery")).toBe(fb); // neither → fallback
});

it("withEntries extends the base and overrides only the matching entry", () => {
  const q = mk("queue");
  const p = mk("process");
  const base = withEntries(empty(mk("fb")), [forKind("queue", q), forKind("process", p)]);

  const q2 = mk("queue-v2");
  const extended = withEntries(base, [forKind("queue", q2)]);

  expect(widgetFor(extended, "x", "queue")).toBe(q2); // overridden
  expect(widgetFor(extended, "x", "process")).toBe(p); // base entry intact
});

it("isLeafTag accepts a keyed tag, rejects groups and non-tags", () => {
  expect(isLeafTag({ key: "app/Q" })).toBe(true);
  expect(isLeafTag({ members: {} })).toBe(false); // a group has no `key`
  expect(isLeafTag(null)).toBe(false);
  expect(isLeafTag("app/Q")).toBe(false);
  expect(isLeafTag({ key: 42 })).toBe(false); // key must be a string
});
