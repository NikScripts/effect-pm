/**
 * @module ui/GateView
 *
 * Shared Gate View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as Gate from "../Gate";
import * as View from "./View";

/** @public */
export const gateViewSpec = { kind: Gate.kind } as const;

/** @public */
export class GateCard extends View.Tag<GateCard>()(
  "hyperlink/view/gate-card",
  "card",
  gateViewSpec,
) {}

/** @public */
export class GateDetail extends View.Tag<GateDetail>()(
  "hyperlink/view/gate-detail",
  "detail",
  gateViewSpec,
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(Gate.kind, GateCard),
  View.bind(Gate.kind, GateDetail),
);
