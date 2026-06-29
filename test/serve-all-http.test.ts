import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// Many resources, one Host, ONE server/port (the ControlService.make({group,port}) replacement).
class LeagueHost extends Resource.Host<LeagueHost>("serveAll/host") {}
class Alpha extends Resource.Tag<Alpha>()("serveAll/Alpha", 
  { where: Resource.query(Schema.String) },
  { host: LeagueHost },
) {}
class Beta extends Resource.Tag<Beta>()("serveAll/Beta", 
  { where: Resource.query(Schema.String), shout: Resource.mutate(Schema.String, { payload: { msg: Schema.String } }) },
  { host: LeagueHost },
) {}

const Server = Resource.serveAllHttp([
  { tag: Alpha, impl: { where: Effect.succeed("alpha") } },
  { tag: Beta, impl: { where: Effect.succeed("beta"), shout: ({ msg }: { msg: string }) => Effect.succeed(msg.toUpperCase()) } },
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("serves many resources on one host/port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const transport = Resource.connectHttp(LeagueHost, { url: `http://127.0.0.1:${port}/rpc` });
      yield* Effect.gen(function* () {
        const a = yield* Alpha;
        const b = yield* Beta;
        expect(yield* a.where).toBe("alpha");
        expect(yield* b.where).toBe("beta");
        expect(yield* b.shout({ msg: "hi" })).toBe("HI");
      }).pipe(
        Effect.provide(Layer.mergeAll(
          Resource.client(Alpha).pipe(Layer.provide(transport)),
          Resource.client(Beta).pipe(Layer.provide(transport)),
        )),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));
