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
export class FleetCard extends View.Tag<FleetCard>()(
  "hyperlink/view/fleet-card",
  "card",
  fleetHealthViewSpec,
) {}

/** @public */
export class FleetDetail extends View.Tag<FleetDetail>()(
  "hyperlink/view/fleet-detail",
  "detail",
  fleetHealthViewSpec,
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(FleetHealth.kind, FleetCard),
  View.bind(FleetHealth.kind, FleetDetail),
);
