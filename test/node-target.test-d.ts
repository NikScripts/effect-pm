/**
 * Type tests for the {@link Node.Tag} address overload — mirrors clientHttp's `target`:
 * a port, a `":port"`, a full url, an explicit `{ url }`, or nothing.
 * Dialable targets narrow to {@link Node.AddressedNode}; bare stays unaddressed.
 */
import * as Node from "../src/Node";

// no address
class A extends Node.Tag<A>("app/A") {}
// port number → http://localhost:3001/rpc
class B extends Node.Tag<B>("app/B", 3001) {}
// ":port" string
class C extends Node.Tag<C>("app/C", ":3002") {}
// full url, used as-is
class D extends Node.Tag<D>("app/D", "https://mail.internal/rpc") {}
// explicit { url }
class E extends Node.Tag<E>("app/E", { url: "http://10.0.0.1:3003/rpc" }) {}
// ipc path
class F extends Node.Tag<F>("app/F", { path: "/tmp/f.sock" }) {}

// the resolved address is carried on the node as `url` / `path`
const _urls: ReadonlyArray<string | undefined> = [A.url, B.url, C.url, D.url, E.url];
void _urls;

const _bare: undefined = A.kind;
const _http: Node.ProtocolKind = B.kind;
const _ipc: Node.ProtocolKind = F.kind;
const _addressed: Node.AddressedNode<B> = B;
void _bare;
void _http;
void _ipc;
void _addressed;

// @ts-expect-error — bare Tag is not AddressedNode
const _notAddressed: Node.AddressedNode<A> = A;
void _notAddressed;
