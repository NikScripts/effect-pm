import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

// Compile-time proof that `Node.connect` and its `connectHttp` / `connectSocket` shortcuts dispatch
// correctly across every call style: data-first derived, data-first explicit, data-last (pipeable), and
// the bare pipe form (`node.pipe(connect)`). The bare pipe relies on the node→Layer overload being
// declared LAST (TS selects the last overload for a function used as a bare value); direct calls still
// resolve top-down. Each line below is a real `Effect.provide(program, <connect layer>)` — that they
// type-check IS the assertion; the runtime `it` just confirms they built.
class AddrNode extends Node.Tag<AddrNode>("cd/addr", { url: "wss://x/rpc" }) {}
class BareNode extends Node.Tag<BareNode>("cd/bare") {}
const prog = Effect.void as Effect.Effect<void, never, AddrNode>;
const proto = Resource.protocolHttp("http://x/rpc");

const dcDerived = Effect.provide(prog, Node.connect(AddrNode)); // data-first, derived
const dcExplicit = Effect.provide(prog, Node.connect(AddrNode, proto)); // data-first, explicit
const dcPipeDerived = Effect.provide(prog, AddrNode.pipe(Node.connect)); // pipe, derived
const dcPipeProto = Effect.provide(prog, AddrNode.pipe(Node.connect(proto))); // pipe, data-last protocol
const dcPipeHttp = Effect.provide(prog, AddrNode.pipe(Node.connectHttp)); // pipe, http shortcut
const dcPipeSocket = Effect.provide(prog, AddrNode.pipe(Node.connectSocket)); // pipe, socket shortcut
const dcPipeSocketUrl = Effect.provide(prog, AddrNode.pipe(Node.connectSocket("/rpc"))); // pipe, socket + url

describe("connect dual dispatch", () => {
  it("every connect / connectHttp / connectSocket call style type-checks and builds", () => {
    expect(typeof Node.connect(proto)).toBe("function"); // data-last returns a node-taker
    const built = [
      dcDerived,
      dcExplicit,
      dcPipeDerived,
      dcPipeProto,
      dcPipeHttp,
      dcPipeSocket,
      dcPipeSocketUrl,
    ];
    expect(built.every((e) => Effect.isEffect(e))).toBe(true);
  });

  it("deriving from a bare (unaddressed) node fails the Layer with UnaddressedNode", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const layer = Node.connect(
          BareNode as Node.AnyNode & {
            readonly url?: string;
            readonly path?: string;
            readonly kind?: Node.ProtocolKind;
          },
        );
        const exit = yield* Effect.exit(Layer.build(layer).pipe(Effect.scoped));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(String(exit.cause)).toMatch(/UnaddressedNode|url|kind/i);
        }
      }),
    ));
});
