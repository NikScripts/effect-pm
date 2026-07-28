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

const CardProto = View.Card.Prototype()({
  spec: apiMetricsViewSpec,
});
const DetailProto = View.Detail.Prototype()({
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
  View.bind(Gate.httpApiClientKind, ApiCard),
  View.bind(Gate.httpApiClientKind, ApiDetail),
);
