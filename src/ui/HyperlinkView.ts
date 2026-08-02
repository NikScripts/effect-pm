/**
 * @module ui/HyperlinkView
 *
 * Shared generic Hyperlink card View handle + contribution Layer — no platform TSX.
 * Card-only (no detail body yet).
 */
import * as Hyperlink from "../Hyperlink";
import * as Ui from "./Ui";

/** @public */
export const hyperlinkViewSpec = { kind: Hyperlink.kind } as const;

/** @public */
export class HyperlinkCard extends Ui.Card.Tag<HyperlinkCard>()(
  "hyperlink/view/hyperlink-card",
  { spec: hyperlinkViewSpec },
) {}

/** @public */
export const layer = Ui.bind(Hyperlink.kind, HyperlinkCard);
