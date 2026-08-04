import { Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// `Tag<Self, I>()`: an existing service **interface** is the source of truth. The contract gives a
// schema only for the wired member (`add`); every other interface member becomes a local, written
// **bare** (`Hyperlink.local`, no `()`), its type taken from the interface. One merged handle: wired +
// local members sit together; the locals just carry a `Local<CounterShape>` requirement that the local
// layer grants (and a client can't). The interface is a standalone type — passing the class itself
// would be a circular base reference.
interface CounterShape {
  readonly current: Effect.Effect<number>; // local effect
  readonly add: (by: number) => Effect.Effect<number>; // wired
  readonly admin: {
    readonly reset: Effect.Effect<void>; // nested local effect
  };
  readonly label: string; // local raw value → Effect<string, Local>
}
class Counter extends Hyperlink.Service<Counter, CounterShape>()("tag-iface/Counter", {
  current: Hyperlink.local,
  add: Hyperlink.effectFn(Schema.Number, Schema.Number),
  admin: {
    reset: Hyperlink.local,
  },
  label: Hyperlink.local,
}) {}

it("Tag<Self, I> merged handle serves wired + local (effect / nested / raw value) via the local layer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      // The impl is the service itself — the wired handler plus each local's interface-shaped value.
      // `ImplOf` types each local from the interface (a wrong-typed local impl would not compile).
      const layer = Hyperlink.layer(Counter, {
        current: Effect.succeed(5),
        add: (by: number) => Effect.succeed(by + 1),
        admin: { reset: Effect.void },
        label: "ctr",
      });

      yield* Effect.gen(function* () {
        const c = yield* Counter;
        // local effect — passes through, its Local requirement satisfied by the granted cap:
        expect(yield* c.current).toBe(5);
        // wired member — a normal client method:
        expect(yield* c.add(41)).toBe(42);
        // nested local effect:
        yield* c.admin.reset;
        // raw-value local — lifted to Effect<string, Local>, `yield*` obtains it:
        expect(yield* c.label).toBe("ctr");
      }).pipe(Effect.provide(layer));
    }),
  ));

it("Tag<Self, I> serves over RPC — the wired member crosses http; locals stay off the wire", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      // An interface Tag serves exactly like any serviceKey: only its wired members are mounted
      // (locals are off-wire), and the impl provides the whole interface.
      const server = Node.httpServer([
        Hyperlink.serve(Counter, {
          current: Effect.succeed(5),
          add: (by: number) => Effect.succeed(by + 1),
          admin: { reset: Effect.void },
          label: "ctr",
        }),
      ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      yield* Effect.gen(function* () {
        const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
        const port = addr._tag === "TcpAddress" ? addr.port : 0;
        yield* Effect.gen(function* () {
          const c = yield* Counter; // the client handle
          // the wired member round-trips over real http:
          expect(yield* c.add(41)).toBe(42);
        }).pipe(
          Effect.provide(
            Hyperlink.client(Counter).pipe(
              Layer.provide(Hyperlink.protocolHttp(`http://127.0.0.1:${port}/rpc`)),
            ),
          ),
          Effect.scoped,
        );
      }).pipe(Effect.provide(server), Effect.scoped);
    }),
  ));
