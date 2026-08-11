---
"hyperlink-ts": minor
---

Resolve `NodePolicy` PrimaryAddress / Listen / Advertise against the `Node.make`
address list (legacy dial stamps + `Lookup.directoryAdvertiseLayer`). Unknown
`as` / label-list selections fail at typecheck and runtime
(`Node.UnknownAddressLabel`). Empty primary when Advertise/Listen is `"Primary"`
fails loudly via `Node.EmptyPrimarySet` / `Node.resolveNodeAddresses` (deferred
through pipe intermediates).
