import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as Resource from "../src/Resource";

// Compile-time proof that `Resource.connect` and its `connectHttp` / `connectSocket` shortcuts dispatch
// correctly across every call style: data-first derived, data-first explicit, data-last (pipeable), and
// the bare pipe form (`node.pipe(connect)`). The bare pipe relies on the node→Layer overload being
// declared LAST (TS selects the last overload for a function used as a bare value); direct calls still
// resolve top-down. Each line below is a real `Effect.provide(program, <connect layer>)` — that they
// type-check IS the assertion; the runtime `it` just confirms they built.
class AddrNode extends Resource.Node<AddrNode>("cd/addr", { url: "wss://x/rpc" }) {}
class BareNode extends Resource.Node<BareNode>("cd/bare") {}
const prog = Effect.void as Effect.Effect<void, never, AddrNode>;
const proto = Resource.protocolHttp("http://x/rpc");

const dcDerived = Effect.provide(prog, Resource.connect(AddrNode)); // data-first, derived
const dcExplicit = Effect.provide(prog, Resource.connect(AddrNode, proto)); // data-first, explicit
const dcPipeDerived = Effect.provide(prog, AddrNode.pipe(Resource.connect)); // pipe, derived
const dcPipeProto = Effect.provide(prog, AddrNode.pipe(Resource.connect(proto))); // pipe, data-last protocol
const dcPipeHttp = Effect.provide(prog, AddrNode.pipe(Resource.connectHttp)); // pipe, http shortcut
const dcPipeSocket = Effect.provide(prog, AddrNode.pipe(Resource.connectSocket)); // pipe, socket shortcut
const dcPipeSocketUrl = Effect.provide(prog, AddrNode.pipe(Resource.connectSocket("/rpc"))); // pipe, socket + url

describe("connect dual dispatch", () => {
  it("every connect / connectHttp / connectSocket call style type-checks and builds", () => {
    expect(typeof Resource.connect(proto)).toBe("function"); // data-last returns a node-taker
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

  it("deriving from a bare (unaddressed) node fails loudly, not silently", () => {
    // the node never declared a url/kind — connect can't guess a transport, so it throws with a
    // remediation message rather than building a layer that fails opaquely at the first call.
    expect(() => Resource.connect(BareNode as never)).toThrow(/UnaddressedNode|url|kind/i);
  });
});
