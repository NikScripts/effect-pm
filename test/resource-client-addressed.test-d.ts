/**
 * Type-gated auto-connect: `client(tag, AddressedNode)` and node-bearing
 * `client(Tag)` with an addressed `{ node }` are fully wired; bare stays fail-closed.
 */
import { Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import { NodeStatusTag } from "../src/internal/nodeStatus";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// Default-on verify may put NodeUnreachable on E — R must still be never when addressed.
declare const runFullyWired: <A, E>(layer: Layer.Layer<A, E, never>) => void;

class Droplet extends Node.Tag<Droplet>()("ca/Droplet", { url: "wss://x/rpc" }) {}
class PortNode extends Node.Tag<PortNode>()("ca/Port", 3001) {}
class Bare extends Node.Tag<Bare>()("ca/Bare") {}

// Dialable Tag → AddressedNode → auto-connect, R = never
runFullyWired(Hyperlink.client(NodeStatusTag, Droplet));

// Bare node: still needs Node in R — not fully wired
// @ts-expect-error — bare client(tag, Bare) still requires Bare
runFullyWired(Hyperlink.client(NodeStatusTag, Bare));

// Derived connect is compile-gated on AddressedNode
// @ts-expect-error — bare Tag cannot derive connect
Node.connect(Bare);

// Explicit protocol still wires a bare node
const proto = Hyperlink.protocolHttp("http://x/rpc");
runFullyWired(
  Hyperlink.client(NodeStatusTag, Bare).pipe(
    Layer.provide(Node.connect(Bare, proto)),
  ),
);

// Node-bearing tag with addressed node → client(Tag) fully wired
class HostedOk extends Hyperlink.Tag<HostedOk>()(
  "ca/HostedOk",
  { ping: Hyperlink.effect(Schema.String) },
  { node: Droplet },
) {}
const hostedOkClient = Hyperlink.client(HostedOk);
runFullyWired(hostedOkClient);

// Node-bearing tag with bare node → still requires Bare
class HostedBare extends Hyperlink.Tag<HostedBare>()(
  "ca/HostedBare",
  { ping: Hyperlink.effect(Schema.String) },
  { node: Bare },
) {}
const hostedBareClient = Hyperlink.client(HostedBare);
// @ts-expect-error — bare-bound client(HostedBare) still requires Bare
runFullyWired(hostedBareClient);

// Kind-precise Tag overloads
expectTypeOf(Droplet.kind).toEqualTypeOf<"WebSocket">();
expectTypeOf(PortNode.kind).toEqualTypeOf<"Http">();
expectTypeOf(Bare.kind).toEqualTypeOf<undefined>();

// `.pipe(nodes([Addressed]))` / `.pipe(andNode(Addressed))` ≡ `{ node }` for client(Tag)
class PipedNodes extends Hyperlink.Tag<PipedNodes>()(
  "ca/PipedNodes",
  { ping: Hyperlink.effect(Schema.String) },
).pipe(Hyperlink.nodes([Droplet])) {}
const pipedNodesClient = Hyperlink.client(PipedNodes);
runFullyWired(pipedNodesClient);

class PipedAndNode extends Hyperlink.Tag<PipedAndNode>()(
  "ca/PipedAndNode",
  { ping: Hyperlink.effect(Schema.String) },
).pipe(Hyperlink.andNode(Droplet)) {}
const pipedAndNodeClient = Hyperlink.client(PipedAndNode);
runFullyWired(pipedAndNodeClient);

// Multi-node set (size ≠ 1): client(Tag) is not fully wired
class MultiNodes extends Hyperlink.Tag<MultiNodes>()(
  "ca/MultiNodes",
  { ping: Hyperlink.effect(Schema.String) },
).pipe(Hyperlink.nodes([Droplet, PortNode])) {}
const multiNodesClient = Hyperlink.client(MultiNodes);
// @ts-expect-error — multi-node: no sole AddressedNode for auto-connect
runFullyWired(multiNodesClient);
