import { Effect, Schema } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { expect, it } from "vitest";
import { Resource, forwardClient, groupOf, specOf } from "../src/Resource";

// A resource with both a no-payload method (property) and a payload method.
class Echo extends Resource.Tag<Echo>("test/Echo")({
  ping: Resource.query(Schema.String),
  shout: Resource.mutate(Schema.String, { payload: { msg: Schema.String } }),
}) {}

// True two-sided round-trip in-process: the real `Resource.server` handlers are wired to
// the same `forwardClient` the production client layer uses, over RpcTest's in-memory
// transport. So `yield* svc.*` runs the client forwarder → wire → server → impl → back.
it("client ↔ server round-trips in-memory", () => {
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Echo));
    const svc = forwardClient(rpc, specOf(Echo), Echo.groupId, Echo.id);

    expect(yield* svc.ping).toBe("pong");
    expect(yield* svc.shout({ msg: "hi" })).toBe("HI");
  }).pipe(
    Effect.provide(
      Resource.server(Echo, {
        ping: Effect.succeed("pong"),
        shout: ({ msg }) => Effect.succeed(msg.toUpperCase()),
      }),
    ),
    Effect.scoped,
  );
  // The group is precisely typed, so the client's `R` is honest — the program resolves
  // to `R = never` after providing the server, and runs with no cast.
  return Effect.runPromise(program);
});

// ── multi-instance: many instances of one factory, one server, routed by id ──
const Counter = Resource.tagFor("counter", {
  bump: Resource.mutate(Schema.Number, { payload: { by: Schema.Number } }),
  label: Resource.query(Schema.String),
});
class Alpha extends Counter<Alpha>("test/Alpha") {}
class Beta extends Counter<Beta>("test/Beta") {}

it("server family routes calls to the right instance by id header", () => {
  // Two independent instance impls behind ONE shared contract group.
  let alphaTotal = 0;
  let betaTotal = 0;
  const alphaImpl = {
    bump: ({ by }: { by: number }) =>
      Effect.sync(() => (alphaTotal += by)),
    label: Effect.succeed("alpha"),
  };
  const betaImpl = {
    bump: ({ by }: { by: number }) => Effect.sync(() => (betaTotal += by)),
    label: Effect.succeed("beta"),
  };

  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Counter));
    const a = forwardClient(rpc, specOf(Counter), Alpha.groupId, Alpha.id);
    const b = forwardClient(rpc, specOf(Counter), Beta.groupId, Beta.id);

    // routed by id: each forwarder pins its own instance id as a header
    expect(yield* a.label).toBe("alpha");
    expect(yield* b.label).toBe("beta");
    expect(yield* a.bump({ by: 3 })).toBe(3);
    expect(yield* b.bump({ by: 10 })).toBe(10);
    expect(yield* a.bump({ by: 4 })).toBe(7);
    expect(yield* b.bump({ by: 1 })).toBe(11);
  }).pipe(
    Effect.provide(
      Resource.serverFamily(
        Counter,
        Resource.instance(Alpha, alphaImpl),
        Resource.instance(Beta, betaImpl),
      ),
    ),
    Effect.scoped,
  );
  return Effect.runPromise(program);
});

// ── shared server: two DIFFERENT resource types with a same-named method don't collide ──
class Widgets extends Resource.Tag<Widgets>("widgets")({
  size: Resource.query(Schema.Number), // same method name as Crates.size, different type
}) {}
class Crates extends Resource.Tag<Crates>("crates")({
  size: Resource.query(Schema.String),
}) {}

it("two resource types sharing a method name coexist on one server (group prefix)", () => {
  // One server hosts both: their groups merge into one root, distinguished by group prefix.
  const root = groupOf(Widgets).merge(groupOf(Crates));
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(root);
    const widgets = forwardClient(rpc, specOf(Widgets), Widgets.groupId, Widgets.id);
    const crates = forwardClient(rpc, specOf(Crates), Crates.groupId, Crates.id);

    // each `size` resolves to its own resource despite the shared method name
    expect(yield* widgets.size).toBe(42);
    expect(yield* crates.size).toBe("dozen");
  }).pipe(
    Effect.provide(Resource.server(Widgets, { size: Effect.succeed(42) })),
    Effect.provide(Resource.server(Crates, { size: Effect.succeed("dozen") })),
    Effect.scoped,
  );
  return Effect.runPromise(program);
});
