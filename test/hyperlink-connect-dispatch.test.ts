import { Effect, Layer } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// Compile-time proof that `Node.connect` and its `connectHttp` / `connectSocket` shortcuts dispatch
// correctly across every call style: data-first derived, data-first explicit, data-last (pipeable), and
// the bare pipe form (`node.pipe(connect)`). The bare pipe relies on the node→Layer overload being
// declared LAST (TS selects the last overload for a function used as a bare value); direct calls still
// resolve top-down. Each line below is a real `Effect.provide(program, <connect layer>)` — that they
// type-check IS the assertion; the runtime `it` just confirms they built.
class AddrNode extends Node.Service<AddrNode>()("cd/addr", { url: "wss://x/rpc" }) {}
class BareNode extends Node.Service<BareNode>()("cd/bare") {}
const prog = Effect.void as Effect.Effect<void, never, AddrNode>;
const proto = Hyperlink.protocolHttp("http://x/rpc");

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

  it("derived connect is referentially stable per Node class (MemoMap share)", () => {
    // client(A,W) + client(B,W) + Node.connect(W) must be the *same* Layer object
    expect(Node.connect(AddrNode)).toBe(Node.connect(AddrNode));
  });

  it.effect("deriving from a bare (unaddressed) node fails the Layer with UnaddressedNode", () =>
    Effect.gen(function* () {
      // Public `connect` is gated on AddressedNode; exercise the runtime path via cast.
      const layer = Node.connect(
        BareNode as unknown as Node.AddressedNode<BareNode>,
      );
      const exit = yield* Effect.exit(Layer.build(layer).pipe(Effect.scoped));
      expectTaggedFailure(exit, "UnaddressedNode");
    }),
  );
});
