import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// Many resources, one Node, ONE server/port (the ControlService.make({group,port}) replacement).
class LeagueNode extends Node.Service<LeagueNode>()("serveAll/node") {}
class Alpha extends Hyperlink.Service<Alpha>()("serveAll/Alpha", 
  { where: Hyperlink.effect(Schema.String) },
  { node: LeagueNode },
) {}
class Beta extends Hyperlink.Service<Beta>()("serveAll/Beta", 
  { where: Hyperlink.effect(Schema.String), shout: Hyperlink.effectFn({ msg: Schema.String }, Schema.String) },
  { node: LeagueNode },
) {}

const Server = Node.httpServer([
  // Alpha via the spec-checked record `Hyperlink.serve`; Beta via the Effect-form `serve`
  // (impl built by an `Effect`). Both coexist in one `httpServer` and the result requirement
  // unions cleanly.
  Hyperlink.serve(Alpha, { where: Effect.succeed("alpha") }),
  Hyperlink.serve(
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
      const transport = Hyperlink.http(LeagueNode, { url: `http://127.0.0.1:${port}/rpc` });
      yield* Effect.gen(function* () {
        const a = yield* Alpha;
        const b = yield* Beta;
        expect(yield* a.where).toBe("alpha");
        expect(yield* b.where).toBe("beta");
        expect(yield* b.shout({ msg: "hi" })).toBe("HI");
      }).pipe(
        Effect.provide(Layer.mergeAll(
          Hyperlink.client(Alpha).pipe(Layer.provide(transport)),
          Hyperlink.client(Beta).pipe(Layer.provide(transport)),
        )),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));
