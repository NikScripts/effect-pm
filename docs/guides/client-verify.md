{#client-verify title="Client verify" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/client-verify>.
<!-- docs-site-link:end -->
# Client verify — fail fast when the peer is wrong

Addressed clients should not hang on a dead peer or silently talk past a stale contract.
`Hyperlink.verifyConnection` is the probe; addressed `Hyperlink.client` (and `Hyperlink.ws`)
run it **by default**. Mode is a `hyperlink-ts/Policy` fragment (`Policy.verifyOff` /
`verifyStatus` / `verifyReject`) — compose with `Policy.provide`. Nodeless
`Hyperlink.connect(tag, protocol)` does not probe — call verify yourself when you want
fail-fast there.

Living recipe is this page + [Policy](/docs/policy). Design history (may lag Policy fragments):
[`docs/handoffs/loud-failures-design.md`](../handoffs/loud-failures-design.md) ·
[`docs/handoffs/verify-connection-classification.md`](../handoffs/verify-connection-classification.md).

## Default-on (addressed clients)

Building an addressed client Layer probes the peer before the handle is usable:

| Fragment | Mode | Behavior |
|----------|------|----------|
| `Policy.verifyReject` | `"reject"` (**default**) | Probe fails → Layer fails (`NodeUnreachable`, or deep errors below) |
| `Policy.verifyStatus` | `"status"` | Probe runs; failure is ignored (connect proceeds) |
| `Policy.verifyOff` | `false` | Skip verify |

```ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Policy from "hyperlink-ts/Policy"

// Opt out for a nested/bootstrap client (Lookup.client / identity ping do this internally):
Hyperlink.client(Emails, WorkerNode).pipe(Policy.provide(Policy.verifyOff))

// Soft: probe but don't fail the Layer
Hyperlink.client(Emails, WorkerNode).pipe(Policy.provide(Policy.verifyStatus))

// Explicit reject (same as default — useful in a named bundle)
Hyperlink.client(Emails, WorkerNode).pipe(Policy.provide(Policy.verifyReject))
```

Tag-aware addressed clients escalate to **deep** verify (node-handle status RPC + service readiness +
F4 `contractHash`). Nodeless / bootstrap paths that would deadlock keep verify off.

## Explicit probe

```ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"

yield* Hyperlink.verifyConnection(WorkerNode) // tier 1 — transport reachability
yield* Hyperlink.verifyConnection(WorkerNode, { timeout: "1 second" })
yield* Hyperlink.verifyConnection(WorkerNode, { deep: true }) // + node status RPC
yield* Hyperlink.verifyConnection(WorkerNode, {
  deep: true,
  serviceKey: Emails.key,
  contractHash: Hyperlink.contractHash(Emails),
})
yield* Hyperlink.verifyConnection(WorkerNode, { all: true }) // every declared endpoint
```

## Failure ladder

| Failure | When |
|---------|------|
| `NodeUnreachable` | Transport probe fails (tier 1) |
| `ProtocolUnanswered` | Transport up, node status RPC silent |
| `ServiceNotServed` / `ServiceNotReady` | Deep + `serviceKey` key missing / not ready |
| `ContractMismatch` | Deep + `contractHash` disagrees with the peer (F4) |
| `ProtocolMismatch` | Wrong transport (e.g. http client → ws server) on a call |
| `MissingClientProtocol` | Nodeless `client(tag)` with no ambient protocol |

Catch via `Exit` / `_tag` — remediation messages name the fix.

## Examples

| Form | Run |
|------|-----|
| Tiers + `Policy.verify*` | `pnpm run example:node-verify-connection` |
| Docs page | [Node — verifyConnection](/docs/node-verify-connection) |

## See also

- [Policy](/docs/policy) — `verifyOff` / `verifyStatus` / `verifyReject` + cutover fragments
- [Identity coordinator](/docs/identity-coordinator) — Lookup dial paths that nest clients
- [Readiness](/docs/readiness) — runtime health after the Layer is up
- [Launcher](/docs/launcher) — Ready poll reuses the same status / verify substrate
