/**
 * @module ui/TelemetryView
 *
 * Shared Telemetry View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as Telemetry from "../Telemetry";
import * as View from "./View";

/** @public */
export const telemetryViewSpec = { kind: Telemetry.kind } as const;

/** @public */
export class TelemetryCard extends View.Tag<TelemetryCard>()(
  "hyperlink/view/telemetry-card",
  "card",
  telemetryViewSpec,
) {}

/** @public */
export class TelemetryDetail extends View.Tag<TelemetryDetail>()(
  "hyperlink/view/telemetry-detail",
  "detail",
  telemetryViewSpec,
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(Telemetry.kind, TelemetryCard),
  View.bind(Telemetry.kind, TelemetryDetail),
);
