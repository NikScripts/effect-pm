/**
 * @module ui/ShardMapView
 *
 * Shared View handles + contribution Layer + observe **pack** — no platform TSX.
 */
import { Layer } from "effect";
import * as ShardMap from "../ShardMap";
import { shardMapPack as pack } from "./pollViewPacks";
import * as Views from "./Views";
export { pack };

/** @public */
export const shardMapViewSpec = { kind: ShardMap.kind } as const;

/** @public */
export class ShardMapCard extends Views.Card.Tag<ShardMapCard>()(
  "hyperlink/view/shardmap-card",
  { spec: shardMapViewSpec },
) {}

/** @public */
export class ShardMapDetail extends Views.Detail.Tag<ShardMapDetail>()(
  "hyperlink/view/shardmap-detail",
  { spec: shardMapViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  Views.bind(ShardMap.kind, ShardMapCard),
  Views.bind(ShardMap.kind, ShardMapDetail),
);
