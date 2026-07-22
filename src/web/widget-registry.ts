/**
 * @module web/widget-registry
 *
 * How the dashboard grid picks a card for each resource. A widget is bound to a resource **kind**
 * (its type — every tag carries one, see {@link Hyperlink.kindOf}) or to an exact **key** (one
 * specific resource). Resolution is **key first, then kind, then a basic fallback**, so a custom
 * card for one queue wins over the generic queue card, which wins over "unknown".
 *
 * The built-in {@link base} set covers the standard kinds. Extend or override it with
 * {@link withEntries} + {@link forKind} / {@link forKey} and hand the result to
 * `<Dashboard widgets={…} />` — you always build **onto the base**, so a single override never drops
 * the rest.
 */
import { HashMap, Match, Option } from "effect";
import * as React from "react";

/** A resource tag as the registry sees it — its wire {@link key} is all the registry needs to look
 *  one up; the widget yields the tag itself for its live data. @public */
export interface LeafTag {
  readonly key: string;
}

/** A group member that isn't a subgroup is a resource tag — it carries a wire `key`. The leaf
 *  counterpart to `Group.isGroup`, so a cell can narrow without a cast. @public */
export const isLeafTag = (m: unknown): m is LeafTag =>
  (typeof m === "object" || typeof m === "function") &&
  m !== null &&
  "key" in m &&
  typeof m.key === "string";

/** Props every widget receives: the resource tag, its display `name` (the key under its group), and
 *  an `onOpen` to drill into its detail page. @public */
export interface WidgetProps {
  readonly tag: LeafTag;
  readonly name: string;
  readonly onOpen: (tag: LeafTag) => void;
}

/** A card component for one resource. @public */
export interface Widget {
  (props: WidgetProps): React.ReactElement;
}

/** The widget set. An exact {@link byKey} match beats a {@link byKind} match; `fallback` renders any
 *  resource neither covers (a bare `…/Hyperlink`, or a kind nobody registered). @public */
export interface WidgetRegistry {
  readonly byKey: HashMap.HashMap<string, Widget>;
  readonly byKind: HashMap.HashMap<string, Widget>;
  readonly fallback: Widget;
}

/** One registry addition — bind a widget to a resource **kind** or an exact **key**. @public */
export type WidgetEntry =
  | { readonly _tag: "kind"; readonly kind: string; readonly widget: Widget }
  | { readonly _tag: "key"; readonly key: string; readonly widget: Widget };

/** Bind a widget to every resource of a kind — e.g. `forKind(QueueResource.kind, MyQueueCard)`. @public */
export const forKind = (kind: string, widget: Widget): WidgetEntry => ({ _tag: "kind", kind, widget });

/** Bind a widget to one exact resource key — overrides that resource's kind widget. @public */
export const forKey = (key: string, widget: Widget): WidgetEntry => ({ _tag: "key", key, widget });

/** Apply entries onto a base registry. Each entry **extends** the base, or **overrides** the matching
 *  key/kind — the base is always the floor, so an override never drops the other widgets. @public */
export const withEntries = (
  base: WidgetRegistry,
  entries: ReadonlyArray<WidgetEntry>,
): WidgetRegistry =>
  entries.reduce(
    (reg, entry) =>
      Match.value(entry).pipe(
        Match.tag("kind", ({ kind, widget }) => ({ ...reg, byKind: HashMap.set(reg.byKind, kind, widget) })),
        Match.tag("key", ({ key, widget }) => ({ ...reg, byKey: HashMap.set(reg.byKey, key, widget) })),
        Match.exhaustive,
      ),
    base,
  );

/** Resolve the widget for a resource: exact `key`, else `kind`, else the fallback. @public */
export const widgetFor = (reg: WidgetRegistry, key: string, kind: string): Widget =>
  HashMap.get(reg.byKey, key).pipe(
    Option.orElse(() => HashMap.get(reg.byKind, kind)),
    Option.getOrElse(() => reg.fallback),
  );

const WidgetsContext = React.createContext<WidgetRegistry | null>(null);

/** Provide the widget registry to the dashboard subtree — `<Dashboard>` does this from its `widgets`
 *  prop (default = the built-in {@link base}). @public */
export const WidgetsProvider = (props: {
  readonly registry: WidgetRegistry;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(WidgetsContext.Provider, { value: props.registry }, props.children);

/** The widget registry from context (throws if no `WidgetsProvider` / `<Dashboard>` above). @public */
export const useWidgets = (): WidgetRegistry => {
  const reg = React.useContext(WidgetsContext);
  if (reg === null) throw new Error("useWidgets: render inside <WidgetsProvider> (or use <Dashboard>)");
  return reg;
};
