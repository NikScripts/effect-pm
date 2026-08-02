/**
 * @module ui/ApiMetricsView
 *
 * Shared View handles + contribution Layer + observe **pack** for {@link Gate.HttpApiClient}.
 */
import { Layer } from "effect";
import * as Gate from "../Gate";
import { pack } from "./apiMetricsViewPack";
import * as View from "./View";
export { pack };

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
