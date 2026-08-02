/**
 * @module ui/FleetHealthView
 *
 * Shared View handles + contribution Layer + observe **pack** — no platform TSX.
 */
import { Layer } from "effect";
import * as FleetHealth from "../FleetHealth";
import { fleetHealthPack as pack } from "./pollViewPacks";
import * as Ui from "./Ui";

export { pack };

/** @public */
export const fleetHealthViewSpec = { kind: FleetHealth.kind } as const;

/** @public */
export class FleetCard extends Ui.Card.Tag<FleetCard>()(
  "hyperlink/view/fleet-card",
  { spec: fleetHealthViewSpec },
) {}

/** @public */
export class FleetDetail extends Ui.Detail.Tag<FleetDetail>()(
  "hyperlink/view/fleet-detail",
  { spec: fleetHealthViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  Ui.bind(FleetHealth.kind, FleetCard),
  Ui.bind(FleetHealth.kind, FleetDetail),
);
