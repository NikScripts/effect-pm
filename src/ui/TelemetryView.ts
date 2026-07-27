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
export const TelemetryCard = View.make({
  key: "hyperlink/view/telemetry-card",
  kind: "card",
  spec: telemetryViewSpec,
});

/** @public */
export const TelemetryDetail = View.make({
  key: "hyperlink/view/telemetry-detail",
  kind: "detail",
  spec: telemetryViewSpec,
});

/** @public */
export const layer = Layer.mergeAll(
  View.kind(Telemetry.kind, TelemetryCard),
  View.kind(Telemetry.kind, TelemetryDetail),
);
