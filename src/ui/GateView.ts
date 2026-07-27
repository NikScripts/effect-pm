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
export const GateCard = View.make({
  key: "hyperlink/view/gate-card",
  kind: "card",
  spec: gateViewSpec,
});

/** @public */
export const GateDetail = View.make({
  key: "hyperlink/view/gate-detail",
  kind: "detail",
  spec: gateViewSpec,
});

/** @public */
export const layer = Layer.mergeAll(
  View.kind(Gate.kind, GateCard),
  View.kind(Gate.kind, GateDetail),
);
