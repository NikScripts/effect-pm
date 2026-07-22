import { Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

class Jobs extends Hyperlink.Tag<Jobs>()("nameless-d/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

declare const serve: Layer.Layer<Jobs, never, never>;

const anonList = Node.unix([serve]);
expectTypeOf(anonList).toMatchTypeOf<
  Layer.Layer<Jobs | Node.ListenNode, never, never>
>();

const anonOne = Node.unix(serve);
expectTypeOf(anonOne).toMatchTypeOf<
  Layer.Layer<Jobs | Node.ListenNode, never, never>
>();

class Worker extends Node.Tag<Worker, Jobs>()("nameless-d/Worker", {
  path: "/tmp/x.sock",
}) {}
const named = Node.unix(Worker, [serve]);
expectTypeOf(named).toMatchTypeOf<
  Layer.Layer<Jobs | Node.ListenNode, never, never>
>();

// Neutral listen no longer accepts nameless serve lists
// @ts-expect-error nameless ipc is Node.unix
Node.listen([serve]);
