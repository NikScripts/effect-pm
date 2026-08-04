import { Effect, Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

class Worker extends Node.Service<Worker>()("listen-tag-d/Worker", {
  path: "/tmp/x.sock",
}) {}

class Jobs extends Hyperlink.Service<Jobs>()("listen-tag-d/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}).pipe(Hyperlink.andNode(Worker)) {}

const bound = Node.unix(Jobs, { jobs: Effect.succeed(7) });
expectTypeOf(bound).toMatchTypeOf<
  Layer.Layer<Jobs | Hyperlink.Local<Jobs> | Node.ListenNode, never, never>
>();

class Nodeless extends Hyperlink.Service<Nodeless>()("listen-tag-d/Nodeless", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

// Unbound Tag+impl → nameless (aligned listen siblings).
const nameless = Node.unix(Nodeless, { jobs: Effect.succeed(1) });
expectTypeOf(nameless).toMatchTypeOf<
  Layer.Layer<
    Nodeless | Hyperlink.Local<Nodeless> | Node.ListenNode,
    never,
    never
  >
>();

const namelessHttp = Node.http(Nodeless, { jobs: Effect.succeed(1) }, 3000);
expectTypeOf(namelessHttp).toMatchTypeOf<
  Layer.Layer<
    Nodeless | Hyperlink.Local<Nodeless> | Node.ListenNode,
    never,
    never
  >
>();

const withNode = Node.http(
  Nodeless,
  { jobs: Effect.succeed(1) },
  Worker,
);
expectTypeOf(withNode).toMatchTypeOf<
  Layer.Layer<
    Nodeless | Hyperlink.Local<Nodeless> | Node.ListenNode,
    never,
    never
  >
>();

const singleServe = Node.http(
  Hyperlink.serve(Nodeless, { jobs: Effect.succeed(1) }),
  3000,
);
expectTypeOf(singleServe).toMatchTypeOf<
  Layer.Layer<Nodeless | Node.ListenNode, never, never>
>();

const nodePlusServe = Node.unix(
  Worker,
  Hyperlink.serve(Nodeless, { jobs: Effect.succeed(1) }),
);
expectTypeOf(nodePlusServe).toMatchTypeOf<
  Layer.Layer<Nodeless | Node.ListenNode, never, never>
>();
