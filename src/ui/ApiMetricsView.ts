/**
 * @module ui/ApiMetricsView
 *
 * Shared View handles + contribution Layer + observe **pack** for {@link Gate.HttpApiClient}.
 */
import { Layer } from "effect";
import * as Gate from "../Gate";
import { pack } from "./apiMetricsViewPack";
import * as Ui from "./Ui";

export { pack };

/** Spec stamp for HttpApiClient View handles. @public */
export const apiMetricsViewSpec = { kind: Gate.httpApiClientKind } as const;

/** @public */
export class ApiCard extends Ui.Card.Tag<ApiCard>()(
  "hyperlink/view/api-card",
  { spec: apiMetricsViewSpec },
) {}

/** @public */
export class ApiDetail extends Ui.Detail.Tag<ApiDetail>()(
  "hyperlink/view/api-detail",
  { spec: apiMetricsViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  Ui.bind(Gate.httpApiClientKind, ApiCard),
  Ui.bind(Gate.httpApiClientKind, ApiDetail),
);
