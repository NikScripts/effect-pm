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

const CardProto = View.card.Prototype()({
  spec: shardMapViewSpec,
});
const DetailProto = View.detail.Prototype()({
  spec: shardMapViewSpec,
});

/** @public */
export class ShardMapCard extends CardProto.Tag<ShardMapCard>()(
  "hyperlink/view/shardmap-card",
) {}

/** @public */
export class ShardMapDetail extends DetailProto.Tag<ShardMapDetail>()(
  "hyperlink/view/shardmap-detail",
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(ShardMap.kind, ShardMapCard),
  View.bind(ShardMap.kind, ShardMapDetail),
);
