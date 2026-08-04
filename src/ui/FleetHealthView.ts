/**
 * @module ui/FleetHealthView
 *
 * Shared View handles + contribution Layer + observe **pack** — no platform TSX.
 */
import { Layer } from "effect";
import * as FleetHealth from "../FleetHealth";
import { fleetHealthPack as pack } from "./pollViewPacks";
import * as Views from "./Views";
export { pack };

/** @public */
export const fleetHealthViewSpec = { kind: FleetHealth.kind } as const;

/** @public */
export class FleetCard extends Views.Card.Service<FleetCard>()(
  "hyperlink/view/fleet-card",
  { spec: fleetHealthViewSpec },
) {}

/** @public */
export class FleetDetail extends Views.Detail.Service<FleetDetail>()(
  "hyperlink/view/fleet-detail",
  { spec: fleetHealthViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  Views.bind(FleetHealth.kind, FleetCard),
  Views.bind(FleetHealth.kind, FleetDetail),
);
