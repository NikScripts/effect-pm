/**
 * @module ui/widgetRegistry
 *
 * How a dashboard grid picks chrome for each HyperService. A widget is bound to a HyperService **kind**
 * (stamped on every tag — see {@link Hyperlink.kindOf}) or to an exact **key**. Resolution is
 * **key → kind → fallback**, so a custom card for one queue wins over the generic queue card,
 * which wins over "unknown".
 *
 * Renderer-agnostic: `W` is whatever the host mounts (DOM card, Ink cell, …). Web and TUI each
 * build a `WidgetRegistry<W>` (`withEntries` + `forKind` / `forKey`) and pass it to `<Dashboard
 * widgets={…} />`.
 *
 */
import { HashMap, Match, Option } from "effect";

/** A HyperService tag as the registry sees it — wire {@link key} is enough to look one up. @public */
export interface LeafTag {
  readonly key: string;
}

/** Leaf counterpart to `Group.isGroup` — a member with a string `key`. @public */
export const isLeafTag = (m: unknown): m is LeafTag =>
  (typeof m === "object" || typeof m === "function") &&
  m !== null &&
  "key" in m &&
  typeof m.key === "string";

/** The widget set for one renderer. Exact {@link byKey} beats {@link byKind}; `fallback` covers
 *  anything neither matches. @public */
export interface WidgetRegistry<W> {
  readonly byKey: HashMap.HashMap<string, W>;
  readonly byKind: HashMap.HashMap<string, W>;
  readonly fallback: W;
}

/** One registry addition — bind a widget to a **kind** or an exact **key**. @public */
export type WidgetEntry<W> =
  | { readonly _tag: "Kind"; readonly kind: string; readonly widget: W }
  | { readonly _tag: "Key"; readonly key: string; readonly widget: W };

/** Bind a widget to every HyperService of a kind — e.g. `forKind(WorkPool.kind, MyQueueCard)`. @public */
export const forKind = <W>(kind: string, widget: W): WidgetEntry<W> => ({
  _tag: "Kind",
  kind,
  widget,
});

/** Bind a widget to one exact resource key — overrides that HyperService's kind widget. @public */
export const forKey = <W>(key: string, widget: W): WidgetEntry<W> => ({
  _tag: "Key",
  key,
  widget,
});

/** Apply entries onto a base registry. Each entry extends or overrides; the base is the floor. @public */
export const withEntries = <W>(
  base: WidgetRegistry<W>,
  entries: ReadonlyArray<WidgetEntry<W>>,
): WidgetRegistry<W> =>
  entries.reduce(
    (reg, entry) =>
      Match.value(entry).pipe(
        Match.tag("Kind", ({ kind, widget }) => ({
          ...reg,
          byKind: HashMap.set(reg.byKind, kind, widget),
        })),
        Match.tag("Key", ({ key, widget }) => ({
          ...reg,
          byKey: HashMap.set(reg.byKey, key, widget),
        })),
        Match.exhaustive,
      ),
    base,
  );

/** Resolve the widget for a serviceKey: exact `key`, else `kind`, else the fallback. @public */
export const widgetFor = <W>(reg: WidgetRegistry<W>, key: string, kind: string): W =>
  HashMap.get(reg.byKey, key).pipe(
    Option.orElse(() => HashMap.get(reg.byKind, kind)),
    Option.getOrElse(() => reg.fallback),
  );

/** Empty registry shell (caller supplies `fallback`). @public */
export const emptyRegistry = <W>(fallback: W): WidgetRegistry<W> => ({
  byKey: HashMap.empty(),
  byKind: HashMap.empty(),
  fallback,
});
