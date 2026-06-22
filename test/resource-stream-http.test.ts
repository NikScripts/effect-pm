import {
  Deferred,
  Effect,
  Fiber,
  Layer,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { Resource, groupOf } from "../src/Resource";

// Streaming `.changes` over a REAL http transport (the in-memory RpcTest path is the blocker
// the design note flagged — this proves the wire works end to end). Streams need a
// newline-delimited serialization for chunked responses, so client + server use ndjson.
class Ticker extends Resource.Tag<Ticker>("stream/Ticker")({
  current: Resource.query(Schema.Number),
  changes: Resource.stream(Schema.Number),
}) {}

const TickerServer = HttpRouter.serve(
  RpcServer.layerHttp({
    group: groupOf(Ticker),
    path: "/rpc",
    protocol: "http",
  }).pipe(
    Layer.provide(
      Resource.server(Ticker, {
        current: Effect.succeed(0),
        // a finite snapshot stream — deterministic proof the elements cross the wire in order
        changes: Stream.fromIterable([1, 2, 3]),
      }),
    ),
  ),
).pipe(
  Layer.provideMerge(RpcSerialization.layerNdjson),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const clientHttp = (port: number) =>
  RpcClient.layerProtocolHttp({
    url: `http://127.0.0.1:${port}/rpc`,
  }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

it("streams a resource's changes over real http (chunked, in order)", () => {
  const program = Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((server) => server.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;

    yield* Effect.gen(function* () {
      const ticker = yield* Ticker;
      // `changes` is a `Stream`, not an `Effect` — drained to a chunk here.
      const seen = yield* Stream.runCollect(ticker.changes);
      expect(Array.from(seen)).toEqual([1, 2, 3]);
      // one-shot reads still work on the same resource
      expect(yield* ticker.current).toBe(0);
    }).pipe(
      Effect.provide(Resource.client(Ticker).pipe(Layer.provide(clientHttp(port)))),
      Effect.scoped,
    );
  }).pipe(Effect.provide(TickerServer), Effect.scoped);
  return Effect.runPromise(program as Effect.Effect<void, unknown>);
});

// The real use case: a live status source backed by a `SubscriptionRef` — the impl pattern a
// resource uses for `changes`. A mutation pushes a new value; a subscriber sees the latest
// then each subsequent change (dashboard atom / CLI --watch / TUI). Exercised in-process
// (local layer) with a `Deferred` ready-latch so the subscription is established before the
// updates — deterministic, no cross-wire timing race.
class Status extends Resource.Tag<Status>("stream/Status")({
  set: Resource.mutate(Schema.Void, { payload: { value: Schema.String } }),
  changes: Resource.stream(Schema.String),
}) {}

it("a SubscriptionRef-backed `changes` drives live status updates", () => {
  const program = Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make("idle");
    const StatusLive = Resource.layer(Status, {
      set: ({ value }) => SubscriptionRef.set(ref, value),
      changes: SubscriptionRef.changes(ref),
    });

    yield* Effect.gen(function* () {
      const status = yield* Status;
      const ready = yield* Deferred.make<void>();
      // subscribe first (replays "idle"), latch ready, then drive two updates
      const fiber = yield* status.changes.pipe(
        Stream.tap(() => Deferred.succeed(ready, void 0)),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(ready);
      yield* status.set({ value: "running" });
      yield* status.set({ value: "done" });
      const seen = yield* Fiber.join(fiber);
      expect(Array.from(seen)).toEqual(["idle", "running", "done"]);
    }).pipe(Effect.provide(StatusLive));
  });
  return Effect.runPromise(program);
});
