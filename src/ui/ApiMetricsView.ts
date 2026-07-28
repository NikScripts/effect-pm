/**
 * @module ui/ApiMetricsView
 *
 * Shared View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as ApiMetrics from "../ApiMetrics";
import * as View from "./View";

/** Placeholder until ApiMetrics exports a control Spec SSOT. @public */
export const apiMetricsViewSpec = { kind: ApiMetrics.kind } as const;

const CardProto = View.card.Prototype()({
  spec: apiMetricsViewSpec,
});
const DetailProto = View.detail.Prototype()({
  spec: apiMetricsViewSpec,
});

/** @public */
export class ApiCard extends CardProto.Tag<ApiCard>()(
  "hyperlink/view/api-card",
) {}

/** @public */
export class ApiDetail extends DetailProto.Tag<ApiDetail>()(
  "hyperlink/view/api-detail",
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(ApiMetrics.kind, ApiCard),
  View.bind(ApiMetrics.kind, ApiDetail),
);
