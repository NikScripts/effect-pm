/**
 * Hyperlink View registry shell — resolves stamped kinds via Group + kindOf.
 *
 * @module ui/viewBase
 */
import { Layer } from "effect";
import * as View from "last-ts/View";
import * as Group from "../Group";
import { kindOf } from "../Hyperlink";

/** Registry Layer with Hyperlink kind resolution for {@link View.bind} by kind. */
export const base: Layer.Layer<View.Registry> = Layer.sync(View.Registry, () =>
  View.makeRegistryService((tag) => {
    if (Group.isGroup(tag)) return [Group.kind];
    const k = kindOf(tag as never);
    return typeof k === "string" ? [k] : [];
  }),
);
