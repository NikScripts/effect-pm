import { Effect, Layer, Schema } from "effect";
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
const _factoryB: Effect.Effect<void, never, TickB> = Effect.gen(function* () {
  yield* (yield* TickB).tick;
});
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
    Effect.provide(Resource.client(Remote)),
    Effect.provide(protocolLayer),
  ),
);
void _remoteRun;
