---
"hyperlink-ts": minor
---

**Type-gated client auto-connect** — `Resource.client(Tag, Worker)` fully wires the transport when `Worker` is an {@link AddressedNode} (dialable `Node.Tag` target). Bare nodes stay fail-closed and still need `Node.connect` / lookup / `clientLocal`.

- `Node.Tag` / `Node.Lookup` overloads: dialable targets (`port` / url / `{ path }` / `{ url }`) return `kind: ProtocolKind` ({@link AddressedNode}); bare tags keep `kind: undefined`.
- `Node.connect(node)` derived form requires {@link AddressedNode} (compile error on bare).
- `Node.clientsFor` relies on per-client auto-connect (no extra `provide(connect)`).
- New: `Node.isAddressedNode`, type `DialableTarget`.
