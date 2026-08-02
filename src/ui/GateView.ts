/**
 * @module ui/GateView
 *
 * Shared View handles + contribution Layer + observe **pack** — no platform TSX.
 */
import { Layer } from "effect";
import * as Gate from "../Gate";
import { pack } from "./gateViewPack";
import * as Views from "./Views";
export { pack };

/** @public */
export const gateViewSpec = { kind: Gate.kind } as const;

/** @public */
export class GateCard extends Views.Card.Tag<GateCard>()(
  "hyperlink/view/gate-card",
  { spec: gateViewSpec },
) {}

/** @public */
export class GateDetail extends Views.Detail.Tag<GateDetail>()(
  "hyperlink/view/gate-detail",
  { spec: gateViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  Views.bind(Gate.kind, GateCard),
  Views.bind(Gate.kind, GateDetail),
);
