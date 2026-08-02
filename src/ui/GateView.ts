/**
 * @module ui/GateView
 *
 * Shared View handles + contribution Layer + observe **pack** — no platform TSX.
 */
import { Layer } from "effect";
import * as Gate from "../Gate";
import { pack } from "./gateViewPack";
import * as Ui from "./Ui";

export { pack };

/** @public */
export const gateViewSpec = { kind: Gate.kind } as const;

/** @public */
export class GateCard extends Ui.Card.Tag<GateCard>()(
  "hyperlink/view/gate-card",
  { spec: gateViewSpec },
) {}

/** @public */
export class GateDetail extends Ui.Detail.Tag<GateDetail>()(
  "hyperlink/view/gate-detail",
  { spec: gateViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  Ui.bind(Gate.kind, GateCard),
  Ui.bind(Gate.kind, GateDetail),
);
