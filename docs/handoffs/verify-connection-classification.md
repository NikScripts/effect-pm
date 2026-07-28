# Design: `verifyConnection` failure classification

**Status:** **LOCKED + Eng’d** (owner “Do it”, 2026-07-21). D1–D5 as recommended below.
**F4 follow-up (2026-07-21):** D4 unlocked — `contractHash` Eng’d (owner “All of them”).
**Thread:** loud-failures / impossible-states. Unblocked after multi-protocol nodes (X1) shipped.
**Related:** [`loud-failures-design.md`](./loud-failures-design.md) · [`multi-protocol-nodes.md`](./multi-protocol-nodes.md) · `NodeStatus`.

## The gap (closed)

`Hyperlink.verifyConnection(node, opts?)` shipped as the **F3 reachability backstop**: one bounded
transport connection, fail `NodeUnreachable | UnaddressedNode`. Every failure collapsed to
`NodeUnreachable`. Deep mode now escalates via `NodeStatus`:

| Reality | Result |
|---|---|
| Nothing listening | `NodeUnreachable` |
| Transport up, RPC silent / wrong protocol | `ProtocolUnanswered` (`{ deep: true }`) |
| Right host, absent service | `ServiceNotServed` (`{ deep: true, resource }`) |
| Right service, not ready | `ServiceNotReady` (`{ deep: true, resource }`) |
| Right service, stale wire contract | `ContractMismatch` (`{ deep: true, resource, contractHash }`) |

## Classification — four tiers

```
verifyConnection(node)                         // reachability (default, unchanged)
  └─ transport connect fails ........ NodeUnreachable        (tier 1)

verifyConnection(node, { deep: true })         // escalate through the tiers
  ├─ transport connects, protocol handshake fails ... ProtocolUnanswered   (tier 2)
  └─ transport + protocol OK → dial NodeStatus.status
       ├─ target key ∉ status.services ......... ServiceNotServed  (tier 3a)
       ├─ target key present but ready === false . ServiceNotReady  (tier 3b)
       └─ contractHash ≠ expected ................ ContractMismatch (tier 4 / F4)
```

Default endpoint: **`selectEndpoint(node)`** (same as `connect`). `{ all: true }` probes every
declared endpoint. Tag-aware default-on client verify escalates to deep + F4 (except reserved
`NodeStatus`, which stays tier-1).

## Decisions (locked)

- **D1 — Shape.** In-place `verifyConnection(node, { deep })`.
- **D2 — Error model.** Distinct tagged errors: `ProtocolUnanswered`, `ServiceNotServed`, `ServiceNotReady`, `ContractMismatch`.
- **D3 — Multi-protocol.** `selectEndpoint` by default; `{ all: true }` for every transport.
- **D4 — contractHash.** **Eng’d** — optional field on `NodeStatus.services[]`; `Hyperlink.contractHash(tag)`; compare via deep options / default-on addressed client.
- **D5 — Default.** Explicit `verifyConnection` keeps `deep` off; addressed `Hyperlink.client` / `clientHttp` default-on escalate to deep+F4 (§8.6).
