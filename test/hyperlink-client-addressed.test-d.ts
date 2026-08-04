/**
 * Type-gated auto-connect: `client(tag, AddressedNode)` and node-bearing
 * `client(Tag)` with an addressed `{ node }` are fully wired; bare stays fail-closed.
 *
 * Negative cases assert open `R` via {@link Layer.Services} (not `runFullyWired` on a
 * still-required layer — that trips `missingLayerContext` next to `@ts-expect-error`).
 */
import { Layer, Schema } from "effect";
import { expectTypeOf } from "vitest";
import { NodeStatusTag } from "../src/internal/nodeStatus";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// Default-on verify may put NodeUnreachable on E — R must still be never when addressed.
declare const runFullyWired: <A, E>(layer: Layer.Layer<A, E, never>) => void;

class Droplet extends Node.Service<Droplet>()("ca/Droplet", { url: "wss://x/rpc" }) {}
class PortNode extends Node.Service<PortNode>()("ca/Port", 3001) {}
class Bare extends Node.Service<Bare>()("ca/Bare") {}

// Dialable Tag → AddressedNode → auto-connect, R = never
runFullyWired(Hyperlink.client(NodeStatusTag, Droplet));

// Bare node: still needs Bare in R — not fully wired
const bareClient = Hyperlink.client(NodeStatusTag, Bare);
expectTypeOf<Layer.Services<typeof bareClient>>().toEqualTypeOf<Bare>();

// Derived single-arg connect requires AddressedNode — Bare is not addressed.
type BareAddressed = typeof Bare extends Node.AddressedNode<infer _S> ? true : false;
expectTypeOf<BareAddressed>().toEqualTypeOf<false>();

// Explicit protocol still wires a bare node.
const proto = Hyperlink.protocolHttp("http://x/rpc");
runFullyWired(
  Hyperlink.client(NodeStatusTag, Bare).pipe(
    Layer.provide(Node.connect(Bare, proto)),
  ),
);

// Node-bearing tag with addressed node → client(Tag) fully wired
class HostedOk extends Hyperlink.Service<HostedOk>()(
  "ca/HostedOk",
  { ping: Hyperlink.effect(Schema.String) },
  { node: Droplet },
) {}
const hostedOkClient = Hyperlink.client(HostedOk);
runFullyWired(hostedOkClient);

// Node-bearing tag with bare node → still requires Bare
class HostedBare extends Hyperlink.Service<HostedBare>()(
  "ca/HostedBare",
  { ping: Hyperlink.effect(Schema.String) },
  { node: Bare },
) {}
const hostedBareClient = Hyperlink.client(HostedBare);
expectTypeOf<Layer.Services<typeof hostedBareClient>>().toEqualTypeOf<Bare>();

// Kind-precise Tag overloads
expectTypeOf(Droplet.kind).toEqualTypeOf<"WebSocket">();
expectTypeOf(PortNode.kind).toEqualTypeOf<"Http">();
expectTypeOf(Bare.kind).toEqualTypeOf<undefined>();

// `.pipe(nodes([Addressed]))` / `.pipe(andNode(Addressed))` ≡ `{ node }` for client(Tag)
class PipedNodes extends Hyperlink.Service<PipedNodes>()(
  "ca/PipedNodes",
  { ping: Hyperlink.effect(Schema.String) },
).pipe(Hyperlink.nodes([Droplet])) {}
const pipedNodesClient = Hyperlink.client(PipedNodes);
runFullyWired(pipedNodesClient);

class PipedAndNode extends Hyperlink.Service<PipedAndNode>()(
  "ca/PipedAndNode",
  { ping: Hyperlink.effect(Schema.String) },
).pipe(Hyperlink.andNode(Droplet)) {}
const pipedAndNodeClient = Hyperlink.client(PipedAndNode);
runFullyWired(pipedAndNodeClient);

// Multi-node set (size ≠ 1): client(Tag) is not fully wired (protocol / node choice open)
class MultiNodes extends Hyperlink.Service<MultiNodes>()(
  "ca/MultiNodes",
  { ping: Hyperlink.effect(Schema.String) },
).pipe(Hyperlink.nodes([Droplet, PortNode])) {}
const multiNodesClient = Hyperlink.client(MultiNodes);
type MultiR = Layer.Services<typeof multiNodesClient>;
type MultiStillOpen = [MultiR] extends [never] ? false : true;
expectTypeOf<MultiStillOpen>().toEqualTypeOf<true>();
