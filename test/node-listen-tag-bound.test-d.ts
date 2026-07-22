import { Effect, Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

class Worker extends Node.Tag<Worker>()("listen-tag-d/Worker", {
  path: "/tmp/x.sock",
}) {}

class Jobs extends Hyperlink.Tag<Jobs>()("listen-tag-d/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}).pipe(Hyperlink.andNode(Worker)) {}

const bound = Node.unix(Jobs, { jobs: Effect.succeed(7) });
expectTypeOf(bound).toMatchTypeOf<
  Layer.Layer<Jobs | Hyperlink.Local<Jobs> | Node.ListenNode, never, never>
>();

class Nodeless extends Hyperlink.Tag<Nodeless>()("listen-tag-d/Nodeless", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

// @ts-expect-error nodeless Tag — sole Node required
Node.unix(Nodeless, { jobs: Effect.succeed(1) });
