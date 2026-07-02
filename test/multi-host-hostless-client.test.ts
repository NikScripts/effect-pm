import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// a hostless multi-host tag (no `{ host }`) — the fleet is on the tag, but the tag names no single host.
class DbHost extends Resource.Host<DbHost>("hostless-client/DbHost") {}
class FleetDatabase extends Resource.Tag<FleetDatabase>()("hostless-client/FleetDatabase", {
  status: Resource.effect(Schema.Boolean),
}).pipe(
  Resource.multiHost([DbHost]),
) {}

const Server = Resource.serveAllHttp([
  Resource.serverEntry(FleetDatabase, { status: Effect.succeed(true) }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

// The fix for #3: a hostless tag has N instances, so the *client* names which one — `client(tag, host)`.
// The transport resolves from that host service, so the layer requires the host (satisfied by
// connectHttp) — the requirement is enforced at compile time, so it can't fail at runtime with a
// "Service not found: RpcClient/Protocol" the way `client(tag)` (ambient Protocol) did when wired to a
// host service instead.
it("a hostless multiHost tag is client-readable by naming the host: client(tag, host)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((server) => server.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const transport = Resource.connectHttp(DbHost, {
        url: `http://127.0.0.1:${port}/rpc`,
      });
      yield* Effect.gen(function* () {
        const db = yield* FleetDatabase;
        expect(yield* db.status).toBe(true); // read the instance on DbHost over the wire
      }).pipe(
        Effect.provide(Resource.client(FleetDatabase, DbHost).pipe(Layer.provide(transport))),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));
