import { Layer } from "effect";
import * as NodeStatus from "../src/NodeStatus";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// P1: a node's value is a wrapper (`{ protocol }`), type-distinct from a bare `RpcClient.Protocol`.
// So supplying a node where an ambient protocol is required no longer type-checks as fully wired — the
// dashboard's "connecting… forever" bug is now a compile error. This file is the proof: it only
// type-checks if the hole is closed (the `@ts-expect-error` fires).

class Droplet extends Node.Tag<Droplet>()("np/Droplet", { url: "wss://x/rpc" }) {}
const transport = Hyperlink.ws(Droplet, { url: "ws://x/rpc" });

// A sink that only accepts a FULLY-WIRED layer (R = never). E may include
// NodeUnreachable from default-on client verify.
declare const runFullyWired: <A, E>(layer: Layer.Layer<A, E, never>) => void;

// CORRECT: addressed `client(tag, node)` auto-wires connect — fully provided.
runFullyWired(Hyperlink.client(NodeStatus.Tag, Droplet));

// Explicit transport on an addressed node still type-checks (redundant but legal).
runFullyWired(Hyperlink.client(NodeStatus.Tag, Droplet).pipe(Layer.provide(transport)));

// THE HOLE, now closed: a nodeless `client(tag)` given the node *transport* still needs an ambient
// `RpcClient.Protocol` — it is NOT fully wired. Pre-P1 this compiled (requirement collapsed to `never`)
// and then threw at runtime; now it is a type error, so the `@ts-expect-error` is required.
// @ts-expect-error — node transport does not satisfy an ambient RpcClient.Protocol requirement
runFullyWired(Hyperlink.client(NodeStatus.Tag).pipe(Layer.provide(transport)));
