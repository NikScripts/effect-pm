import { Effect, Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

class Worker extends Node.Tag<Worker>()("listen-tag-d/Worker", {
  path: "/tmp/x.sock",
}) {}

class Jobs extends Resource.Tag<Jobs>()("listen-tag-d/Jobs", {
  jobs: Resource.effect(Schema.Number),
}).pipe(Resource.andNode(Worker)) {}

const bound = Node.unix(Jobs, { jobs: Effect.succeed(7) });
expectTypeOf(bound).toMatchTypeOf<
  Layer.Layer<Jobs | Resource.Local<Jobs> | Node.ListenNode, never, never>
>();

class Nodeless extends Resource.Tag<Nodeless>()("listen-tag-d/Nodeless", {
  jobs: Resource.effect(Schema.Number),
}) {}

// @ts-expect-error nodeless Tag — sole Node required
Node.unix(Nodeless, { jobs: Effect.succeed(1) });
