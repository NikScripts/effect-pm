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
export const ShardMapCard = View.make({
  key: "hyperlink/view/shardmap-card",
  kind: "card",
  spec: shardMapViewSpec,
});

/** @public */
export const ShardMapDetail = View.make({
  key: "hyperlink/view/shardmap-detail",
  kind: "detail",
  spec: shardMapViewSpec,
});

/** @public */
export const layer = Layer.mergeAll(
  View.kind(ShardMap.kind, ShardMapCard),
  View.kind(ShardMap.kind, ShardMapDetail),
);
