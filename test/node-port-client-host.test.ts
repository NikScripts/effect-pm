// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";
import { Duration, Effect, Layer, Schema } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Node from "../src/Node";
import * as Hyperlink from "../src/Hyperlink";
import { portOf } from "../src/internal/nodeCore";

// Option B: a bare-port node keeps its port as data; the eager `url` is a localhost PREVIEW, and the
// authoritative dial host resolves from the client `clientHost` Config at the dial boundary. So
// `Node.Tag(port)` dialed and `protocolHttp(port)` behave identically — Config at the edge, value pure.

const PORT = 7813;

class Echo extends Hyperlink.Tag<Echo>()(
  "cfg-dial/Echo",
  { ping: Hyperlink.effect(Schema.String) },
  { node: Node.Tag<never>()("cfg-dial/node", PORT) },
) {}

describe("bare-port node: localhost preview, Config-resolved dial host", () => {
  it("keeps a sync localhost `url` preview but carries the port as data", () => {
    class W extends Node.Tag<W>()("cfg-dial/w", 3009) {}
    class U extends Node.Tag<U>()("cfg-dial/u", "http://example.com/rpc") {}
    expect(W.url).toBe("http://localhost:3009/rpc"); // preview, unchanged (pure, sync)
    expect(portOf(W)).toBe(3009); // the intent, carried for the dial
    expect(portOf(U)).toBeUndefined(); // a full url has no port to resolve
  });

  const server = Node.httpServer([
    Hyperlink.serve(Echo, { ping: Effect.succeed("pong") }),
  ]).pipe(Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: PORT })));

  it.live("default Config → dials the localhost preview and reaches the server", () =>
    Effect.gen(function* () {
      yield* Layer.build(server);
      const pong = yield* Effect.gen(function* () {
        const echo = yield* Echo;
        return yield* echo.ping;
      }).pipe(Effect.provide(Hyperlink.client(Echo)), Effect.scoped);
      expect(pong).toBe("pong");
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  // The host-override behavior (bogus EFFECT_PM_CLIENT_HOST → dial fails to reach the localhost server)
  // is deterministic but not reliable as an in-process vitest: the default ConfigProvider caches the
  // first `clientHost` read, and the earlier tests read `localhost`. It's proven directly instead —
  // a fresh process with the env set dials a bare-port node to the non-routable host and fails.

  // sanity: the Config itself reads the env key with a localhost default
  it.effect("clientHost defaults to localhost", () =>
    Effect.gen(function* () {
      expect(yield* Hyperlink.clientHost).toBe("localhost");
    }),
  );
});
