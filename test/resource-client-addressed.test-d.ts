/**
 * Type-gated auto-connect: `client(tag, AddressedNode)` and node-bearing
 * `client(Tag)` with an addressed `{ node }` are fully wired; bare stays fail-closed.
 */
import { Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as NodeStatus from "../src/NodeStatus";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

declare const runFullyWired: <A>(layer: Layer.Layer<A, never, never>) => void;

class Droplet extends Node.Tag<Droplet>("ca/Droplet", { url: "wss://x/rpc" }) {}
class PortNode extends Node.Tag<PortNode>("ca/Port", 3001) {}
class Bare extends Node.Tag<Bare>("ca/Bare") {}

// Dialable Tag → AddressedNode → auto-connect, R = never
runFullyWired(Resource.client(NodeStatus.Tag, Droplet));

// Bare node: still needs Node in R — not fully wired
// @ts-expect-error — bare client(tag, Bare) still requires Bare
runFullyWired(Resource.client(NodeStatus.Tag, Bare));

// Derived connect is compile-gated on AddressedNode
// @ts-expect-error — bare Tag cannot derive connect
Node.connect(Bare);

// Explicit protocol still wires a bare node
const proto = Resource.protocolHttp("http://x/rpc");
runFullyWired(
  Resource.client(NodeStatus.Tag, Bare).pipe(
    Layer.provide(Node.connect(Bare, proto)),
  ),
);

// Node-bearing tag with addressed node → client(Tag) fully wired
class HostedOk extends Resource.Tag<HostedOk>()(
  "ca/HostedOk",
  { ping: Resource.effect(Schema.String) },
  { node: Droplet },
) {}
const hostedOkClient = Resource.client(HostedOk);
runFullyWired(hostedOkClient);

// Node-bearing tag with bare node → still requires Bare
class HostedBare extends Resource.Tag<HostedBare>()(
  "ca/HostedBare",
  { ping: Resource.effect(Schema.String) },
  { node: Bare },
) {}
const hostedBareClient = Resource.client(HostedBare);
// @ts-expect-error — bare-bound client(HostedBare) still requires Bare
runFullyWired(hostedBareClient);

// Kind-precise Tag overloads
expectTypeOf(Droplet.kind).toEqualTypeOf<"WebSocket">();
expectTypeOf(PortNode.kind).toEqualTypeOf<"Http">();
expectTypeOf(Bare.kind).toEqualTypeOf<undefined>();

// `.pipe(nodes([Addressed]))` / `.pipe(andNode(Addressed))` ≡ `{ node }` for client(Tag)
class PipedNodes extends Resource.Tag<PipedNodes>()(
  "ca/PipedNodes",
  { ping: Resource.effect(Schema.String) },
).pipe(Resource.nodes([Droplet])) {}
const pipedNodesClient = Resource.client(PipedNodes);
runFullyWired(pipedNodesClient);

class PipedAndNode extends Resource.Tag<PipedAndNode>()(
  "ca/PipedAndNode",
  { ping: Resource.effect(Schema.String) },
).pipe(Resource.andNode(Droplet)) {}
const pipedAndNodeClient = Resource.client(PipedAndNode);
runFullyWired(pipedAndNodeClient);

// Multi-node set (size ≠ 1): client(Tag) is not fully wired
class MultiNodes extends Resource.Tag<MultiNodes>()(
  "ca/MultiNodes",
  { ping: Resource.effect(Schema.String) },
).pipe(Resource.nodes([Droplet, PortNode])) {}
const multiNodesClient = Resource.client(MultiNodes);
// @ts-expect-error — multi-node: no sole AddressedNode for auto-connect
runFullyWired(multiNodesClient);
