# Design: `verifyConnection` failure classification

**Status:** **LOCKED + Eng’d** (owner “Do it”, 2026-07-21). D1–D5 as recommended below.
**Thread:** loud-failures / impossible-states. Unblocked after multi-protocol nodes (X1) shipped.
**Related:** [`loud-failures-design.md`](./loud-failures-design.md) · [`multi-protocol-nodes.md`](./multi-protocol-nodes.md) · `NodeStatus`.

## The gap (closed)

`Resource.verifyConnection(node, opts?)` shipped as the **F3 reachability backstop**: one bounded
transport connection, fail `NodeUnreachable | UnaddressedNode`. Every failure collapsed to
`NodeUnreachable`. Deep mode now escalates via `NodeStatus`:

| Reality | Result |
|---|---|
| Nothing listening | `NodeUnreachable` |
| Transport up, RPC silent / wrong protocol | `ProtocolUnanswered` (`{ deep: true }`) |
| Right host, absent service | `ServiceNotServed` (`{ deep: true, resource }`) |
| Right service, not ready | `ServiceNotReady` (`{ deep: true, resource }`) |

## Classification — three tiers

```
verifyConnection(node)                         // reachability (default, unchanged)
  └─ transport connect fails ........ NodeUnreachable        (tier 1)

verifyConnection(node, { deep: true })         // escalate through the tiers
  ├─ transport connects, protocol handshake fails ... ProtocolUnanswered   (tier 2)
  └─ transport + protocol OK → dial NodeStatus.status
       ├─ target key ∉ status.resources ......... ServiceNotServed  (tier 3a)
       └─ target key present but ready === false . ServiceNotReady  (tier 3b)
```

Default endpoint: **`selectEndpoint(node)`** (same as `connect`). `{ all: true }` probes every
declared endpoint. `contractHash` stays out of scope (D4).

## Decisions (locked)

- **D1 — Shape.** In-place `verifyConnection(node, { deep })`.
- **D2 — Error model.** Distinct tagged errors: `ProtocolUnanswered`, `ServiceNotServed`, `ServiceNotReady`.
- **D3 — Multi-protocol.** `selectEndpoint` by default; `{ all: true }` for every transport.
- **D4 — contractHash.** Out of scope — `NodeStatus.resources` covers wrong/not-ready service.
- **D5 — Default.** `deep` off — tier-1 stays the cheap fast-start check.
