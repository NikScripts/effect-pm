import { Effect, Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

class Jobs extends Resource.Tag<Jobs>()("nameless-d/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

declare const serve: Layer.Layer<Jobs, never, never>;

// Nameless serve-list overload
const anonList = Node.listen([serve]);
expectTypeOf(anonList).toMatchTypeOf<
  Layer.Layer<Jobs | Node.ListenNode, never, never>
>();

// Nameless single-layer overload
const anonOne = Node.listen(serve);
expectTypeOf(anonOne).toMatchTypeOf<
  Layer.Layer<Jobs | Node.ListenNode, never, never>
>();

// Nameless Tag + impl (skips Resource.serve)
const anonTag = Node.listen(Jobs, { jobs: Effect.succeed(7) });
expectTypeOf(anonTag).toMatchTypeOf<
  Layer.Layer<Jobs | Resource.Local<Jobs> | Node.ListenNode, never, never>
>();

// Named form still works
class Worker extends Node.Tag<Worker, Jobs>("nameless-d/Worker", {
  path: "/tmp/x.sock",
}) {}
const named = Node.listen(Worker, [serve]);
expectTypeOf(named).toMatchTypeOf<
  Layer.Layer<Jobs | Node.ListenNode, never, never>
>();
