/**
 * @module ui/HyperlinkView
 *
 * Shared generic Hyperlink card View handle + contribution Layer — no platform TSX.
 * Card-only (no detail body yet).
 */
import * as Hyperlink from "../Hyperlink";
import * as Views from "./Views";
/** @public */
export const hyperlinkViewSpec = { kind: Hyperlink.kind } as const;

/** @public */
export class HyperlinkCard extends Views.Card.Service<HyperlinkCard>()(
  "hyperlink/view/hyperlink-card",
  { spec: hyperlinkViewSpec },
) {}

/** @public */
export const layer = Views.bind(Hyperlink.kind, HyperlinkCard);
