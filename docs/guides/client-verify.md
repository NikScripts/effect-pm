{#client-verify title="Client verify" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/client-verify>.
<!-- docs-site-link:end -->
# Client verify — fail fast when the peer is wrong

Addressed clients should not hang on a dead peer or silently talk past a stale contract.
`Hyperlink.verifyConnection` is the probe; addressed `Hyperlink.client` / `clientHttp` /
`socketClient` run it **by default**.

Handoff SSOT: [`docs/handoffs/loud-failures-design.md`](../handoffs/loud-failures-design.md) ·
[`docs/handoffs/verify-connection-classification.md`](../handoffs/verify-connection-classification.md).

## Default-on (addressed clients)

Building an addressed client Layer probes the peer before the handle is usable:

| Mode | Behavior |
|------|----------|
| `"reject"` (**default**) | Probe fails → Layer fails (`NodeUnreachable`, or deep errors below) |
| `"status"` | Probe runs; failure is ignored (connect proceeds) |
| `false` | Skip verify |

```ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Layer } from "effect"

// Opt out for a nested/bootstrap client (Lookup.client / identity ping do this internally):
Hyperlink.client(Emails, WorkerNode).pipe(
  Layer.provide(Hyperlink.clientVerify(false)),
)

// Soft: probe but don't fail the Layer
Hyperlink.clientHttp(Emails, 3001).pipe(
  Layer.provide(Hyperlink.clientVerify("status")),
)
```

Tag-aware addressed clients escalate to **deep** verify (NodeStatus RPC + resource readiness +
F4 `contractHash`). Nodeless / bootstrap paths that would deadlock keep verify off.

## Explicit probe

```ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"

yield* Hyperlink.verifyConnection(WorkerNode) // tier 1 — transport reachability
yield* Hyperlink.verifyConnection(WorkerNode, { timeout: "1 second" })
yield* Hyperlink.verifyConnection(WorkerNode, { deep: true }) // + NodeStatus RPC
yield* Hyperlink.verifyConnection(WorkerNode, {
  deep: true,
  resource: Emails.groupId,
  contractHash: Hyperlink.contractHash(Emails),
})
yield* Hyperlink.verifyConnection(WorkerNode, { all: true }) // every declared endpoint
```

## Failure ladder

| Failure | When |
|---------|------|
| `NodeUnreachable` | Transport probe fails (tier 1) |
| `ProtocolUnanswered` | Transport up, NodeStatus RPC silent |
| `ServiceNotServed` / `ServiceNotReady` | Deep + `resource` key missing / not ready |
| `ContractMismatch` | Deep + `contractHash` disagrees with the peer (F4) |
| `ProtocolMismatch` | Wrong transport (e.g. http client → ws server) on a call |
| `MissingClientProtocol` | Nodeless `client(tag)` with no ambient protocol |

Catch via `Exit` / `_tag` — remediation messages name the fix.

## See also

- [Identity coordinator](/docs/identity-coordinator) — Lookup dial paths that nest clients
- [Readiness](/docs/readiness) — runtime health after the Layer is up
