import { expectTypeOf } from "vitest";
import * as Node from "../src/Node";
type KindOf<N> = N extends { readonly kind: infer K } ? K : never;

// multi (shorthand) base → widen precisely
class Droplet extends Node.Service<Droplet>()("wp/droplet", { http: "http://d/rpc" }) {}
class DropletWs extends Droplet.pipe(Node.withProtocol({ ws: "/rpc" })) {}
expectTypeOf<KindOf<typeof DropletWs>>().toEqualTypeOf<"Http" | "WebSocket">();

// single-protocol base → widen
class Single extends Node.Service<Single>()("wp/single", { url: "http://x/rpc", kind: "Http" }) {}
class SingleWs extends Single.pipe(Node.withProtocol({ ws: "/rpc" })) {}
expectTypeOf<KindOf<typeof SingleWs>>().toEqualTypeOf<"Http" | "WebSocket">();

// chained — add two
class Tri extends Single.pipe(
  Node.withProtocol({ ws: "/rpc" }),
  Node.withProtocol({ ipc: "/tmp/s.sock" }),
) {}
expectTypeOf<KindOf<typeof Tri>>().toEqualTypeOf<
  "Http" | "WebSocket" | "IpcSocket"
>();
