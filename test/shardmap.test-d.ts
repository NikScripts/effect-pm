/**
 * Type-level pins for ShardMap public `layer` / `serve` / `serveRemote` — no casts.
 * Proof the facade is honestly typed end-to-end (SqlClient discharged; mesh R only).
 */
import { Schema } from "effect";
import type * as Layer from "effect/Layer";
import * as Resource from "../src/Resource";
import * as ShardMap from "../src/ShardMap";
import * as Node from "../src/Node";

class DropletEast extends Node.Tag<DropletEast>("app/DropletEast") {}

const Session = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
});

class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
  key: Schema.String,
  value: Session,
  keyOf: (s) => s.id,
}).pipe(Resource.nodes([DropletEast])) {}

type Mesh = Resource.PeersId<Sessions> | Resource.SelfNodeId<Sessions>;

type LayerOut = Layer.Layer<
  Sessions | Resource.Local<Sessions>,
  never,
  Mesh
>;
type ServeRemoteOut = Layer.Layer<never, never, Mesh>;

const _layerCheck: LayerOut = ShardMap.layer(Sessions);
const _serveRemoteCheck: ServeRemoteOut = ShardMap.serveRemote(Sessions);
const _serveCheck: LayerOut = ShardMap.serve(Sessions);

void [_layerCheck, _serveRemoteCheck, _serveCheck];
