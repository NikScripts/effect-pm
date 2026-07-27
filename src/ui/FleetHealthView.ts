/**
 * @module ui/FleetHealthView
 *
 * Shared FleetHealth View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as FleetHealth from "../FleetHealth";
import * as View from "./View";

/** @public */
export const fleetHealthViewSpec = { kind: FleetHealth.kind } as const;

/** @public */
export const FleetCard = View.make({
  key: "hyperlink/view/fleet-card",
  kind: "card",
  spec: fleetHealthViewSpec,
});

/** @public */
export const FleetDetail = View.make({
  key: "hyperlink/view/fleet-detail",
  kind: "detail",
  spec: fleetHealthViewSpec,
});

/** @public */
export const layer = Layer.mergeAll(
  View.kind(FleetHealth.kind, FleetCard),
  View.kind(FleetHealth.kind, FleetDetail),
);
