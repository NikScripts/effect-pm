/**
 * Type tests for the {@link Node.Tag} address overload — mirrors clientHttp's `target`:
 * a port, a `":port"`, a full url, an explicit `{ url }`, or nothing.
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

// the resolved address is carried on the node as `url`
const _urls: ReadonlyArray<string | undefined> = [A.url, B.url, C.url, D.url, E.url];
void _urls;
