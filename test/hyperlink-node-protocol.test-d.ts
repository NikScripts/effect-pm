import { Layer } from "effect";
import { expectTypeOf } from "vitest";
import { NodeStatusTag } from "../src/internal/nodeStatus";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// P1: a node's value is a wrapper (`{ protocol }`), type-distinct from a bare `RpcClient.Protocol`.
// So supplying a node where an ambient protocol is required no longer type-checks as fully wired — the
// dashboard's "connecting… forever" bug is now a compile error. This file is the proof.

class Droplet extends Node.Service<Droplet>()("np/Droplet", { url: "wss://x/rpc" }) {}
const transport = Hyperlink.ws(Droplet, { url: "ws://x/rpc" });

// A sink that only accepts a FULLY-WIRED layer (R = never). E may include
// NodeUnreachable from default-on client verify.
declare const runFullyWired: <A, E>(layer: Layer.Layer<A, E, never>) => void;

// CORRECT: addressed `client(tag, node)` auto-wires connect — fully provided.
runFullyWired(Hyperlink.client(NodeStatusTag, Droplet));

// Explicit transport on an addressed node still type-checks (redundant but legal).
runFullyWired(Hyperlink.client(NodeStatusTag, Droplet).pipe(Layer.provide(transport)));

// THE HOLE, now closed: a nodeless `client(tag)` given the node *transport* still needs an ambient
// `RpcClient.Protocol` — it is NOT fully wired. Assert open R via Layer.Services (do not call
// `runFullyWired` on an incomplete layer — that trips `missingLayerContext`).
const nodelessWithTransport = Hyperlink.client(NodeStatusTag).pipe(
  Layer.provide(transport),
);
type NodelessR = Layer.Services<typeof nodelessWithTransport>;
type StillNeedsProtocol = [NodelessR] extends [never] ? false : true;
expectTypeOf<StillNeedsProtocol>().toEqualTypeOf<true>();
// Stronger: R is not never (protocol still required after providing only the node transport).
expectTypeOf<[NodelessR] extends [never] ? true : false>().toEqualTypeOf<false>();
