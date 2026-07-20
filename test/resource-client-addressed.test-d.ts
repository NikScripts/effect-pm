/**
 * Type-gated auto-connect: `client(tag, AddressedNode)` is fully wired;
 * bare `NodeKey` still requires the node (or an explicit protocol).
 */
import { Layer } from "effect";
import * as NodeStatus from "../src/NodeStatus";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

declare const runFullyWired: <A>(layer: Layer.Layer<A, never, never>) => void;

class Droplet extends Node.Tag<Droplet>("ca/Droplet", { url: "wss://x/rpc" }) {}
class Bare extends Node.Tag<Bare>("ca/Bare") {}

// Dialable Tag → AddressedNode → auto-connect, R = never
runFullyWired(Resource.client(NodeStatus.Tag, Droplet));

// Bare node: still needs Node in R — not fully wired
// @ts-expect-error — bare client(tag, Bare) still requires Bare
runFullyWired(Resource.client(NodeStatus.Tag, Bare));

// Explicit protocol still wires a bare node
const proto = Resource.protocolHttp("http://x/rpc");
runFullyWired(
  Resource.client(NodeStatus.Tag, Bare).pipe(
    Layer.provide(Node.connect(Bare, proto)),
  ),
);

// Proof: addressed Tag narrows `kind` to ProtocolKind (not undefined)
const _kind: Node.ProtocolKind = Droplet.kind;
const _bareKind: undefined = Bare.kind;
void _kind;
void _bareKind;
