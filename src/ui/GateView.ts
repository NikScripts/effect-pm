/**
 * @module ui/GateView
 *
 * Shared View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as Gate from "../Gate";
import * as View from "./View";

/** @public */
export const gateViewSpec = { kind: Gate.kind } as const;

const CardProto = View.Card.Prototype()({
  spec: gateViewSpec,
});
const DetailProto = View.Detail.Prototype()({
  spec: gateViewSpec,
});

/** @public */
export class GateCard extends CardProto.Tag<GateCard>()(
  "hyperlink/view/gate-card",
) {}

/** @public */
export class GateDetail extends DetailProto.Tag<GateDetail>()(
  "hyperlink/view/gate-detail",
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(Gate.kind, GateCard),
  View.bind(Gate.kind, GateDetail),
);
