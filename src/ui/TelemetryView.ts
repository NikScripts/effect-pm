/**
 * @module ui/TelemetryView
 *
 * Shared View handles + contribution Layer + observe **pack** — no platform TSX.
 */
import { Layer } from "effect";
import * as Telemetry from "../Telemetry";
import { telemetryPack as pack } from "./pollViewPacks";
import * as View from "./View";
export { pack };

/** @public */
export const telemetryViewSpec = { kind: Telemetry.kind } as const;

/** @public */
export class TelemetryCard extends View.Card.Tag<TelemetryCard>()(
  "hyperlink/view/telemetry-card",
  { spec: telemetryViewSpec },
) {}

/** @public */
export class TelemetryDetail extends View.Detail.Tag<TelemetryDetail>()(
  "hyperlink/view/telemetry-detail",
  { spec: telemetryViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(Telemetry.kind, TelemetryCard),
  View.bind(Telemetry.kind, TelemetryDetail),
);
