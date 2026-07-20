import { Effect, Layer, Schema, Stream } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import * as Resource from "../src/Resource";
import type { ServiceOf } from "../src/Resource";
import * as Node from "../src/Node";

// ── Slice 1: spec → service-interface inference ──
// (No `satisfies Spec`: it contextually widens each method's error channel to `unknown`.
// `ServiceOf<typeof _spec>` already enforces `_spec extends Spec` without widening.)
const _spec = {
  current: Resource.effect(Schema.Number), // no payload → property, success = number
  reset: Resource.effect(Schema.Void), // void command → Effect property
  add: Resource.effectFn({ id: Schema.String }, Schema.Void, Schema.String), // payload → method, error channel
};

type S = ServiceOf<typeof _spec>;
declare const s: S;

const _current: Effect.Effect<number, never> = s.current;
void _current;
const _reset: Effect.Effect<void, never> = s.reset;
void _reset;
const _add: (payload: { readonly id: string }) => Effect.Effect<void, string> = s.add;
void _add({ id: "x" });

// @ts-expect-error a no-payload method is a property, not callable
void s.current();

// ── stream methods surface as `Stream`, not `Effect` ──
const _streamSpec = {
  changes: Resource.stream(Schema.Number), // no payload → Stream property
  tail: Resource.stream(Schema.String, { payload: { since: Schema.Number } }), // payload → (p) => Stream
};
type StreamSvc = ServiceOf<typeof _streamSpec>;
declare const ss: StreamSvc;

const _changes: Stream.Stream<number, never> = ss.changes;
void _changes;
const _tail: Stream.Stream<string, never> = ss.tail({ since: 0 });
void _tail;
// @ts-expect-error a stream member is not an Effect
const _notEffect: Effect.Effect<number> = ss.changes;
void _notEffect;

// ── Resource.Resource — `yield* Tag` like Effect.Effect ──
class CounterForResourceType extends Resource.Tag<CounterForResourceType>()("Counter", {
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effect(Schema.Void),
  current: Resource.effect(Schema.Number),
}) {}

const counterSpec = {
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effect(Schema.Void),
  current: Resource.effect(Schema.Number),
} as const;

type CounterShape = Resource.Shape<CounterForResourceType>;
type CounterResource = Resource.Resource<typeof counterSpec, never, never, CounterForResourceType>;
type CounterInferred = Resource.Of<CounterForResourceType>;

declare const counterShape: CounterShape;
declare const _counterResource: CounterResource;
declare const _counterInferred: CounterInferred;
void counterShape;
void _counterResource;
void _counterInferred;

const _counterResourceUse = Effect.gen(function* () {
  const c: Resource.Shape<CounterForResourceType> = yield* CounterForResourceType;
  yield* c.increment({ by: 1 });
  return yield* c.current;
});
void _counterResourceUse;

// Tag is assignable to Resource.Of<typeof Tag> (Context.Service is an Effect).
const _tagIsResource: CounterInferred = CounterForResourceType;
void _tagIsResource;

// ── Slice 2: Tag + `yield*` + local layer ──
class Counter extends Resource.Tag<Counter>()("Counter", {
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effect(Schema.Void),
  current: Resource.effect(Schema.Number),
}) {}

// `yield* Tag` yields the inferred service; requirement is the Tag itself
const _use: Effect.Effect<number, never, Counter> = Effect.gen(function* () {
  const c = yield* Counter;
  yield* c.increment({ by: 1 });
  yield* c.reset;
  return yield* c.current;
});
void _use;

// the local layer accepts a typed implementation of the inferred service
const _layer: Layer.Layer<Counter> = Resource.layer(Counter, {
  increment: ({ by: _by }) => Effect.void,
  reset: Effect.void,
  current: Effect.succeed(0),
});
void _layer;

// ── factory: tagFor bakes a shared spec; instances pass only an id ──
const Counter2 = Resource.tagFor("test/counter", {
  tick: Resource.effect(Schema.Void),
  count: Resource.effect(Schema.Number),
});
class TickA extends Counter2<TickA>("test/TickA") {}
class TickB extends Counter2<TickB>("test/TickB") {}

// both instances share the same inferred service (spec baked into the factory)
const _factoryA: Effect.Effect<number, never, TickA> = Effect.gen(function* () {
  const a = yield* TickA;
  yield* a.tick;
  return yield* a.count;
});
void _factoryA;
const _factoryB: Effect.Effect<void, never, TickB> = Effect.flatMap(
  TickB,
  (b) => b.tick,
);
void _factoryB;

// ── remote path: the client layer's only requirement is the transport `Protocol` ──
// (Locks the precise-group typing: a regression that re-leaked `any` into `R` would
// make this program's `R` non-`never` and fail to satisfy `runPromise`.)
class Remote extends Resource.Tag<Remote>()("test/Remote", {
  ping: Resource.effect(Schema.String),
  shout: Resource.effectFn({ msg: Schema.String }, Schema.String),
}) {}

declare const protocolLayer: Layer.Layer<RpcClient.Protocol>;
const _remoteRun: Promise<string> = Effect.runPromise(
  Effect.gen(function* () {
    const r = yield* Remote;
    return yield* r.ping;
  }).pipe(
    Effect.provide(Resource.client(Remote).pipe(Layer.provide(protocolLayer))),
  ),
);
void _remoteRun;

// ── local-only methods: a non-serializable member gated by Local ──
// A method that returns a function can't cross RPC. Declared with Resource.local, it
// surfaces as `Effect<T, never, Local<Box>>` — callable only when the LOCAL
// layer (which grants the capability) is provided, a compile error under the client.
class Box extends Resource.Tag<Box>()("test/Box", {
  read: Resource.effect(Schema.Number),
  onChange:
    Resource.local<(cb: (n: number) => void) => Effect.Effect<void>>(),
}) {}

const boxImpl = {
  read: Effect.succeed(0),
  onChange: (_cb: (n: number) => void) => Effect.void,
};

// a program that uses the local-only member
const useLocal = Effect.gen(function* () {
  const b = yield* Box;
  const subscribe = yield* b.onChange; // requires Local<Box>
  yield* subscribe(() => {});
});

// LOCAL layer grants the capability → resolves to R = never, runs.
const _localOk: Promise<void> = Effect.runPromise(
  useLocal.pipe(Effect.provide(Resource.layer(Box, boxImpl))),
);
void _localOk;

// CLIENT layer never grants Local → Local<Box> stays unsatisfied.
// Negative test: the missing context IS the point, so both the TS error and the LSP
// missing-context diagnostic on `runPromise` are expected and intentionally suppressed.
const localViaClient = useLocal.pipe(
  Effect.provide(Resource.client(Box).pipe(Layer.provide(protocolLayer))),
);
// Region toggle (not -next-line): the `@ts-expect-error` must sit directly above the code, so the
// effect directive can't also be adjacent — a region off/restore covers the statement regardless.
// @effect-diagnostics missingEffectContext:off
// @ts-expect-error — onChange is local-only; Local<Box> unsatisfied via the client.
const _localViaClient: Promise<void> = Effect.runPromise(localViaClient);
// @effect-diagnostics missingEffectContext:error
void _localViaClient;

// the WIRE method is fine through the client (no capability needed).
const _wireViaClient: Promise<number> = Effect.runPromise(
  Effect.flatMap(Box, (b) => b.read).pipe(
    Effect.provide(Resource.client(Box).pipe(Layer.provide(protocolLayer))),
  ),
);
void _wireViaClient;

// ── clientInstances: one shared client serves many instances of one control shape ──
// (100 processes that can only start/drop cost ONE client, not one each.)
const Proc = Resource.tagFor("proc", {
  start: Resource.effect(Schema.Void),
  drop: Resource.effect(Schema.Void),
});
class P1 extends Proc<P1>("@app/p1") {}
class P2 extends Proc<P2>("@app/p2") {}

// one layer provides BOTH instances; its only requirement is the transport Protocol.
const _procClients: Layer.Layer<P1 | P2, never, RpcClient.Protocol> =
  Resource.clientInstances(Proc, P1, P2);
void _procClients;

// ── node in the tag: ship only the tag; the client resolves where to connect ──
// Bare bound node → client still requires the node (+ explicit protocol via connect).
class EdgeNode extends Node.Tag<EdgeNode>("test/edge") {}
class Hosted extends Resource.Tag<Hosted>()("test/Hosted",
  { ping: Resource.effect(Schema.String) },
  { node: EdgeNode },
) {}

const _nodeedClient: Layer.Layer<Hosted, never, EdgeNode> =
  Resource.client(Hosted);
void _nodeedClient;

const _nodeLive: Layer.Layer<EdgeNode> = Node.connect(EdgeNode, protocolLayer);
void _nodeLive;

const _nodeedRun: Promise<string> = Effect.runPromise(
  Effect.flatMap(Hosted, (h) => h.ping).pipe(
    Effect.provide(
      Resource.client(Hosted).pipe(
        Layer.provide(Node.connect(EdgeNode, protocolLayer)),
      ),
    ),
  ),
);
void _nodeedRun;

// Addressed bound node → client(Tag) auto-connects (fully wired).
class WireNode extends Node.Tag<WireNode>("test/wire", {
  path: "/tmp/test-wire.sock",
}) {}
class HostedWire extends Resource.Tag<HostedWire>()(
  "test/HostedWire",
  { ping: Resource.effect(Schema.String) },
  { node: WireNode },
) {}
const _hostedWire: Layer.Layer<HostedWire> = Resource.client(HostedWire);
void _hostedWire;

// nodeless tag: client still takes the ambient Protocol (additive, non-breaking).
const _nodelessClient: Layer.Layer<Counter, never, RpcClient.Protocol> =
  Resource.client(Counter);
void _nodelessClient;

// ── tagFor with a node: the whole family ships only the tag ──
// One node baked into the factory → every instance is a node-bearing tag.
const NodeProc = Resource.tagFor(
  "nodeedProc",
  { start: Resource.effect(Schema.Void) },
  { node: EdgeNode },
);
class HP1 extends NodeProc<HP1>("@app/hp1") {}

// each instance's client requires the family's node, not the ambient Protocol.
const _hp1Client: Layer.Layer<HP1, never, EdgeNode> = Resource.client(HP1);
void _hp1Client;

// a nodeless factory's instances keep the ambient-Protocol client (Proc, above).
const _p1Client: Layer.Layer<P1, never, RpcClient.Protocol> =
  Resource.client(P1);
void _p1Client;
