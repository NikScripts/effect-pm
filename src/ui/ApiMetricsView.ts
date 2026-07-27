/**
 * @module ui/ApiMetricsView
 *
 * Shared ApiMetrics View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as ApiMetrics from "../ApiMetrics";
import * as View from "./View";

/** Placeholder until ApiMetrics exports a control Spec SSOT. @public */
export const apiMetricsViewSpec = { kind: ApiMetrics.kind } as const;

/** @public */
export const ApiCard = View.make({
  key: "hyperlink/view/api-card",
  kind: "card",
  spec: apiMetricsViewSpec,
});

/** @public */
export const ApiDetail = View.make({
  key: "hyperlink/view/api-detail",
  kind: "detail",
  spec: apiMetricsViewSpec,
});

/** @public */
export const layer = Layer.mergeAll(
  View.kind(ApiMetrics.kind, ApiCard),
  View.kind(ApiMetrics.kind, ApiDetail),
);
