/**
 * @module ui/FleetHealthView
 *
 * Shared View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as FleetHealth from "../FleetHealth";
import * as View from "./View";

/** @public */
export const fleetHealthViewSpec = { kind: FleetHealth.kind } as const;

const CardProto = View.card.Prototype()({
  spec: fleetHealthViewSpec,
});
const DetailProto = View.detail.Prototype()({
  spec: fleetHealthViewSpec,
});

/** @public */
export class FleetCard extends CardProto.Tag<FleetCard>()(
  "hyperlink/view/fleet-card",
) {}

/** @public */
export class FleetDetail extends DetailProto.Tag<FleetDetail>()(
  "hyperlink/view/fleet-detail",
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(FleetHealth.kind, FleetCard),
  View.bind(FleetHealth.kind, FleetDetail),
);
