/**
 * @module ui/ShardMapView
 *
 * Shared View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as ShardMap from "../ShardMap";
import * as View from "./View";

/** @public */
export const shardMapViewSpec = { kind: ShardMap.kind } as const;

/** @public */
export class ShardMapCard extends View.Card.Tag<ShardMapCard>()(
  "hyperlink/view/shardmap-card",
  { spec: shardMapViewSpec },
) {}

/** @public */
export class ShardMapDetail extends View.Detail.Tag<ShardMapDetail>()(
  "hyperlink/view/shardmap-detail",
  { spec: shardMapViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(ShardMap.kind, ShardMapCard),
  View.bind(ShardMap.kind, ShardMapDetail),
);
