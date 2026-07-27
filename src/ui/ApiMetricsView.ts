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
export class ApiCard extends View.Tag<ApiCard>()(
  "hyperlink/view/api-card",
  "card",
  apiMetricsViewSpec,
) {}

/** @public */
export class ApiDetail extends View.Tag<ApiDetail>()(
  "hyperlink/view/api-detail",
  "detail",
  apiMetricsViewSpec,
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.kind(ApiMetrics.kind, ApiCard),
  View.kind(ApiMetrics.kind, ApiDetail),
);
