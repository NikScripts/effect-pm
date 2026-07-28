/**
 * @module ui/ApiMetricsView
 *
 * Shared View handles + contribution Layer for {@link Gate.HttpApiClient}
 * (former sibling ApiMetrics absorbed into the Gate nest).
 */
import { Layer } from "effect";
import * as Gate from "../Gate";
import * as View from "./View";

/** Spec stamp for HttpApiClient View handles. @public */
export const apiMetricsViewSpec = { kind: Gate.httpApiClientKind } as const;

/** @public */
export class ApiCard extends View.Card.Tag<ApiCard>()(
  "hyperlink/view/api-card",
  { spec: apiMetricsViewSpec },
) {}

/** @public */
export class ApiDetail extends View.Detail.Tag<ApiDetail>()(
  "hyperlink/view/api-detail",
  { spec: apiMetricsViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(Gate.httpApiClientKind, ApiCard),
  View.bind(Gate.httpApiClientKind, ApiDetail),
);
