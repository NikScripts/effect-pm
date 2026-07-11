{#multi-node title="Multi-node" order=110 appliesTo=src}
# Multi-node

One resource, running as an instance on each node, meshed by peers. The rules keep the mesh honest:
local where it must be, lazy where it can be, and never silently wrong.

{#one-resource-n-instances .must appliesTo=src}
## One resource = N node-local instances

The consumer holds **one** class — the tag — and each node runs its own instance of it. It is not N
separate resources. `peers(tag)` yields the per-node handles, keyed by node. Groups only organise the
tree; a tag is one node in it.

{#readiness-per-node-local .must appliesTo=src}
## Readiness is per-node and local — never a cross-node hop

A resource's readiness derives from its **own** status (its single source of truth) and aggregates
into that node's `/health` and `NodeStatus`. A node's health never reaches across to another node to
compute itself — that would cascade one node's failure into its neighbours. Fleet-wide health is an
explicit, separate opt-in, never implicit.

{#fold-over-leaf-fields .must appliesTo=src}
## Fold over leaf fields; fleet views stay out of the fan-out

`peers` fans out to each node's leaf handles. A `fleet`-marked method is *already* a combined view,
so it is excluded from the peers fold — otherwise a fold would re-fan-out over an aggregate. Fold over
leaf fields only, and include your own node **explicitly**: self is never silently folded in.

{#peers-are-lazy .must appliesTo=src}
## Peers are lazy and degrade to a partial mesh

`peersLayer` never builds or connects a peer eagerly. A node with no resolvable url is **skipped, not
thrown** — a down or absent peer is a partial mesh, never a boot failure and never a silent permanent
drop. Peer urls come from the node's own `url` or a `Config`-backed resolver: a `ConfigError` fails
the build loudly (fail-fast on misconfiguration), while `Config.option` returning `undefined` skips
that peer. Urls are never frozen into the contract.

{#no-self-reference-in-base .must appliesTo=src}
## A base-class combinator callback can't reference the class being defined

Inside a `class X extends Tag(...).pipe(...)` base, a combinator callback runs while `X` is still
being defined — so it must not reference `X` itself. Referencing *peer* tags is fine; referencing the
class under construction is a use-before-definition trap.

``` ts
// ❌ bad — references the class being defined
class Prices extends QueueResource.Tag<Prices>()("app/Prices", Job)
  .pipe(Resource.withReadiness((svc) => check(Prices))) {}   // Prices isn't defined yet

// ✅ good — read the resource's own status the callback is handed
class Prices extends QueueResource.Tag<Prices>()("app/Prices", Job)
  .pipe(Resource.withReadiness((svc) => Effect.map(svc.status.get, isReady))) {}
```
