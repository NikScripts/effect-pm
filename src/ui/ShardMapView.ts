/**
 * @module ui/ShardMapView
 *
 * Shared ShardMap View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as ShardMap from "../ShardMap";
import * as View from "./View";

/** @public */
export const shardMapViewSpec = { kind: ShardMap.kind } as const;

/** @public */
export class ShardMapCard extends View.Tag<ShardMapCard>()(
  "hyperlink/view/shardmap-card",
  "card",
  shardMapViewSpec,
) {}

/** @public */
export class ShardMapDetail extends View.Tag<ShardMapDetail>()(
  "hyperlink/view/shardmap-detail",
  "detail",
  shardMapViewSpec,
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.kind(ShardMap.kind, ShardMapCard),
  View.kind(ShardMap.kind, ShardMapDetail),
);
