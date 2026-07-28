/**
 * @module ui/TelemetryView
 *
 * Shared View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as Telemetry from "../Telemetry";
import * as View from "./View";

/** @public */
export const telemetryViewSpec = { kind: Telemetry.kind } as const;

const CardProto = View.card.Prototype()({
  spec: telemetryViewSpec,
});
const DetailProto = View.detail.Prototype()({
  spec: telemetryViewSpec,
});

/** @public */
export class TelemetryCard extends CardProto.Tag<TelemetryCard>()(
  "hyperlink/view/telemetry-card",
) {}

/** @public */
export class TelemetryDetail extends DetailProto.Tag<TelemetryDetail>()(
  "hyperlink/view/telemetry-detail",
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(Telemetry.kind, TelemetryCard),
  View.bind(Telemetry.kind, TelemetryDetail),
);
