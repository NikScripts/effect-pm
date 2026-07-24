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

// HyperService deps stay open on listen (same product rule as httpServer).
declare const serveWithDep: Layer.Layer<Jobs, never, "Dep">;
const unixDep = Node.unix(serveWithDep);
expectTypeOf(unixDep).toEqualTypeOf<
  Layer.Layer<Jobs | Node.ListenNode, never, "Dep">
>();
const unixDepList = Node.unix([serveWithDep]);
expectTypeOf(unixDepList).toEqualTypeOf<
  Layer.Layer<Jobs | Node.ListenNode, never, "Dep">
>();
declare const fallibleServe: Layer.Layer<Jobs, "Boom", "Dep">;
const unixFallible = Node.unix(fallibleServe);
expectTypeOf(unixFallible).toEqualTypeOf<
  Layer.Layer<Jobs | Node.ListenNode, "Boom", "Dep">
>();

// Neutral listen no longer accepts nameless serve lists
// @ts-expect-error nameless ipc is Node.unix
Node.listen([serve]);
