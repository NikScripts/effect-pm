/**
 * @module ui/ApiMetricsView
 *
 * Shared View handles + contribution Layer + observe **pack** for {@link Gate.HttpApiClient}.
 */
import { Layer } from "effect";
import * as Gate from "../Gate";
import { pack } from "./apiMetricsViewPack";
import * as Views from "./Views";
export { pack };

/** Spec stamp for HttpApiClient View handles. @public */
export const apiMetricsViewSpec = { kind: Gate.httpApiClientKind } as const;

/** @public */
export class ApiCard extends Views.Card.Service<ApiCard>()(
  "hyperlink/view/api-card",
  { spec: apiMetricsViewSpec },
) {}

/** @public */
export class ApiDetail extends Views.Detail.Service<ApiDetail>()(
  "hyperlink/view/api-detail",
  { spec: apiMetricsViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  Views.bind(Gate.httpApiClientKind, ApiCard),
  Views.bind(Gate.httpApiClientKind, ApiDetail),
);
