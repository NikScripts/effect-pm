/**
 * @module ui/HyperlinkView
 *
 * Shared generic Hyperlink card View handle + contribution Layer — no platform TSX.
 * Card-only (no detail body yet).
 */
import * as Hyperlink from "../Hyperlink";
import * as View from "./View";

/** @public */
export const hyperlinkViewSpec = { kind: Hyperlink.kind } as const;

/** @public */
export const HyperlinkCard = View.make({
  key: "hyperlink/view/hyperlink-card",
  kind: "card",
  spec: hyperlinkViewSpec,
});

/** @public */
export const layer = View.kind(Hyperlink.kind, HyperlinkCard);
