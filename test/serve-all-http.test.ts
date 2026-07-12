import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// Many resources, one Node, ONE server/port (the ControlService.make({group,port}) replacement).
class LeagueNode extends Resource.Node<LeagueNode>("serveAll/node") {}
class Alpha extends Resource.Tag<Alpha>()("serveAll/Alpha", 
  { where: Resource.effect(Schema.String) },
  { node: LeagueNode },
) {}
class Beta extends Resource.Tag<Beta>()("serveAll/Beta", 
  { where: Resource.effect(Schema.String), shout: Resource.effectFn({ msg: Schema.String }, Schema.String) },
  { node: LeagueNode },
) {}

const Server = Resource.httpServer([
  // Alpha via the spec-checked record `Resource.serve`; Beta via the Effect-form `serve`
  // (impl built by an `Effect`). Both coexist in one `httpServer` and the result requirement
  // unions cleanly.
  Resource.serve(Alpha, { where: Effect.succeed("alpha") }),
  Resource.serve(
    Beta,
    Effect.succeed({
      where: Effect.succeed("beta"),
      shout: ({ msg }: { msg: string }) => Effect.succeed(msg.toUpperCase()),
    }),
  ),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("serves many resources on one node/port", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const transport = Resource.httpClient(LeagueNode, { url: `http://127.0.0.1:${port}/rpc` });
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
