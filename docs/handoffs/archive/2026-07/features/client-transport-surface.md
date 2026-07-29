# Design: client transport surface — connect / baked clients / Config-driven port

**Status:** SHIPPED (beta.0 release prep).
**Thread:** follows the `Hyperlink.http/ws/unix/nPipe` rename (client dialers match `Node.*` serve siblings).

## Two client families — the distinction is explicit

| Family | Bakes a transport? | Use |
|---|---|---|
| **`Hyperlink.connect(tag, protocol)`** | **No** — you pass the `Layer<RpcClient.Protocol>`; connect imports zero transports | browser-safe; you choose+bundle exactly one wire |
| **`Hyperlink.http/ws/unix/nPipe(node)`** | **Yes** — the wire is in the name, batteries included | server/CLI one-liners; a node already committed to a transport |

`connect` = *bring your own wire*. `http`/`ws`/… = *the wire is named, and bundled*. Each JSDoc states which, plus a doc-tier note. This is the clarity — no new concept.

- `connect(Emails, Hyperlink.protocolWebsocket("/rpc"))` — browser bundles only ws.
- `connect(Emails, Hyperlink.protocolHttp(3009))` — server; replaces retired `clientHttp(Emails, 3009)`.
- Cast-free: `connect` is tag-only + generic (`<Self, S>`), so no `HyperlinkTag` TS2589.

`clientHttp` is **removed** — folded into `connect(tag, protocolHttp(target))`.

## Port shorthand — Config-driven default host (the most-Effect way)

A bare **port** resolves to `http://${defaultHost}:${port}/rpc`, where `defaultHost` is an Effect **`Config`** defaulting to `"localhost"`:

```ts
export const clientHost: Config.Config<string> = Config.string(
  "HYPERLINK_CLIENT_HOST",
).pipe(Config.withDefault("localhost"))
```

- **Dev**: nothing set → `localhost`. Terse `protocolHttp(3009)` just works.
- **Prod**: app sets `HYPERLINK_CLIENT_HOST=api.myapp.com` → every port shorthand becomes `http://api.myapp.com:3009/rpc`, automatically, everywhere.
- No `NODE_ENV` sniffing — "dev vs prod" is simply "did they configure a host?", expressed as a `Config` with a default. Most Effect.

**Phase boundary (important):** `Config` is read in an **Effect/layer** context, so this applies to the **client dialers** that build layers — `protocolHttp` / `protocolWebsocket` (→ `ws://${defaultHost}:port`) / `connect` / and the batteries clients. It does **not** apply to `Node.Tag(name, 3009)`, which resolves synchronously at class-definition (no runtime to read Config); node *declaration* stays `localhost`. Declaration ≠ dialing.

**Consistency:** one shared Config-driven resolver is used by every client-side function that accepts a port — same behavior across `protocolHttp` / `protocolWebsocket` / `connect` / node-facing `http`/`ws`.

## Build order (done)

1. ✅ Config-driven port resolver (`clientHost` Config + effectful `protocolHttp(port)` / `protocolWebsocket(port)`).
2. ✅ `Hyperlink.connect(tag, protocol)` (no-bake; sugar over `client(tag)` + the provided protocol).
3. ✅ Remove `clientHttp`; migrate its sites to `connect(tag, protocolHttp(target))`.
4. ✅ Docs: the two-family distinction; port-host Config; examples.
5. Gate each step (typecheck / tests / treeshake / markers / LSP).
