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

const HyperlinkCardProto = View.Card.Prototype()({
  spec: hyperlinkViewSpec,
});

/** @public */
export class HyperlinkCard extends HyperlinkCardProto.Tag<HyperlinkCard>()(
  "hyperlink/view/hyperlink-card",
) {}

/** @public */
export const layer = View.bind(Hyperlink.kind, HyperlinkCard);
