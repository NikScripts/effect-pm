/**
 * @module ui/ShardMapView
 *
 * Shared View handles + contribution Layer + observe **pack** — no platform TSX.
 */
import { Layer } from "effect";
import * as ShardMap from "../ShardMap";
import { shardMapPack as pack } from "./pollViewPacks";
import * as Ui from "./Ui";

export { pack };

/** @public */
export const shardMapViewSpec = { kind: ShardMap.kind } as const;

/** @public */
export class ShardMapCard extends Ui.Card.Tag<ShardMapCard>()(
  "hyperlink/view/shardmap-card",
  { spec: shardMapViewSpec },
) {}

/** @public */
export class ShardMapDetail extends Ui.Detail.Tag<ShardMapDetail>()(
  "hyperlink/view/shardmap-detail",
  { spec: shardMapViewSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  Ui.bind(ShardMap.kind, ShardMapCard),
  Ui.bind(ShardMap.kind, ShardMapDetail),
);
