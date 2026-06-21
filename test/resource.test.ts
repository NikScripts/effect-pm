import { Effect, Schema } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { expect, it } from "vitest";
import { Resource, forwardClient, groupOf, specOf } from "../src/Resource";

// A resource with both a no-payload method (property) and a payload method.
class Echo extends Resource.Tag<Echo>("test/Echo")({
  ping: Schema.String,
  shout: { payload: { msg: Schema.String }, success: Schema.String },
}) {}

// True two-sided round-trip in-process: the real `Resource.server` handlers are wired to
// the same `forwardClient` the production client layer uses, over RpcTest's in-memory
// transport. So `yield* svc.*` runs the client forwarder → wire → server → impl → back.
it("client ↔ server round-trips in-memory", () => {
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Echo));
    const svc = forwardClient(rpc, specOf(Echo), Echo.id);

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
  // The loose contract group leaks `any` into `R` via RpcTest's client; the runtime
  // provides the whole environment (this test passes), so we run the resolved program.
  return Effect.runPromise(program as Effect.Effect<void, unknown>);
});
