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
export class HyperlinkCard extends View.Card.Tag<HyperlinkCard>()(
  "hyperlink/view/hyperlink-card",
  { spec: hyperlinkViewSpec },
) {}

/** @public */
export const layer = View.bind(Hyperlink.kind, HyperlinkCard);
