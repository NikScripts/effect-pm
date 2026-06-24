import { Effect, Layer, Schema, Stream } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { Resource } from "../src/Resource";
import type { ServiceOf } from "../src/Resource";

// ── Slice 1: spec → service-interface inference ──
// (No `satisfies Spec`: it contextually widens each method's error channel to `unknown`.
// `ServiceOf<typeof _spec>` already enforces `_spec extends Spec` without widening.)
const _spec = {
  current: Resource.query(Schema.Number), // no payload → property, success = number
  reset: Resource.mutate(Schema.Void), // no payload → property, success = void
  add: Resource.mutate(Schema.Void, {
    payload: { id: Schema.String },
    error: Schema.String,
  }), // payload → method, error channel
};

type S = ServiceOf<typeof _spec>;
declare const s: S;

const _current: Effect.Effect<number, never> = s.current;
void _current;
const _reset: Effect.Effect<void, never> = s.reset;
void _reset;
const _add: Effect.Effect<void, string> = s.add({ id: "x" });
void _add;

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

// ── Slice 2: Tag + `yield*` + local layer ──
class Counter extends Resource.Tag<Counter>("Counter")({
  increment: Resource.mutate(Schema.Void, { payload: { by: Schema.Number } }),
  reset: Resource.mutate(Schema.Void),
  current: Resource.query(Schema.Number),
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
  increment: () => Effect.void,
  reset: Effect.void,
  current: Effect.succeed(0),
});
void _layer;

// ── factory: tagFor bakes a shared spec; instances pass only an id ──
const Counter2 = Resource.tagFor("test/counter", {
  tick: Resource.mutate(Schema.Void),
  count: Resource.query(Schema.Number),
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
class Remote extends Resource.Tag<Remote>("test/Remote")({
  ping: Resource.query(Schema.String),
  shout: Resource.mutate(Schema.String, { payload: { msg: Schema.String } }),
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

// ── local-only methods: a non-serializable member gated by a LocalCapability ──
// A method that returns a function can't cross RPC. Declared with Resource.local, it
// surfaces as `Effect<T, never, LocalCapability<Box>>` — callable only when the LOCAL
// layer (which grants the capability) is provided, a compile error under the client.
class Box extends Resource.Tag<Box>("test/Box")({
  read: Resource.query(Schema.Number),
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
  const subscribe = yield* b.onChange; // requires LocalCapability<Box>
  yield* subscribe(() => {});
});

// LOCAL layer grants the capability → resolves to R = never, runs.
const _localOk: Promise<void> = Effect.runPromise(
  useLocal.pipe(Effect.provide(Resource.layer(Box, boxImpl))),
);
void _localOk;

// CLIENT layer never grants the capability → LocalCapability<Box> stays unsatisfied.
// Negative test: the missing context IS the point, so both the TS error and the LSP
// missing-context diagnostic on `runPromise` are expected and intentionally suppressed.
const localViaClient = useLocal.pipe(
  Effect.provide(Resource.client(Box).pipe(Layer.provide(protocolLayer))),
);
// @effect-diagnostics-next-line missingEffectContext:off
// @ts-expect-error — onChange is local-only; LocalCapability<Box> unsatisfied via the client.
const _localViaClient: Promise<void> = Effect.runPromise(localViaClient);
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
  start: Resource.mutate(Schema.Void),
  drop: Resource.mutate(Schema.Void),
});
class P1 extends Proc<P1>("@app/p1") {}
class P2 extends Proc<P2>("@app/p2") {}

// one layer provides BOTH instances; its only requirement is the transport Protocol.
const _procClients: Layer.Layer<P1 | P2, never, RpcClient.Protocol> =
  Resource.clientInstances(Proc, P1, P2);
void _procClients;

// ── host in the tag: ship only the tag; the client resolves where to connect ──
// A host-bearing tag carries its own transport. `Resource.client(tag)` then requires the
// HOST (not the ambient Protocol), and `Resource.connect(Host, transport)` wires it once.
class EdgeHost extends Resource.Host<EdgeHost>("test/edge") {}
class Hosted extends Resource.Tag<Hosted>("test/Hosted")(
  { ping: Resource.query(Schema.String) },
  EdgeHost,
) {}

// the host-bearing client's only requirement is the host itself.
const _hostedClient: Layer.Layer<Hosted, never, EdgeHost> =
  Resource.client(Hosted);
void _hostedClient;

// Resource.connect re-keys an RPC `Protocol` layer under the host.
const _hostLive: Layer.Layer<EdgeHost> = Resource.connect(EdgeHost, protocolLayer);
void _hostLive;

// full wiring: client(Hosted) needs EdgeHost; host(EdgeHost, …) supplies it → R = never.
const _hostedRun: Promise<string> = Effect.runPromise(
  Effect.flatMap(Hosted, (h) => h.ping).pipe(
    Effect.provide(
      Resource.client(Hosted).pipe(
        Layer.provide(Resource.connect(EdgeHost, protocolLayer)),
      ),
    ),
  ),
);
void _hostedRun;

// hostless tag: client still takes the ambient Protocol (additive, non-breaking).
const _hostlessClient: Layer.Layer<Counter, never, RpcClient.Protocol> =
  Resource.client(Counter);
void _hostlessClient;

// ── tagFor with a host: the whole family ships only the tag ──
// One host baked into the factory → every instance is a host-bearing tag.
const HostedProc = Resource.tagFor(
  "hostedProc",
  { start: Resource.mutate(Schema.Void) },
  { host: EdgeHost },
);
class HP1 extends HostedProc<HP1>("@app/hp1") {}

// each instance's client requires the family's host, not the ambient Protocol.
const _hp1Client: Layer.Layer<HP1, never, EdgeHost> = Resource.client(HP1);
void _hp1Client;

// a hostless factory's instances keep the ambient-Protocol client (Proc, above).
const _p1Client: Layer.Layer<P1, never, RpcClient.Protocol> =
  Resource.client(P1);
void _p1Client;
