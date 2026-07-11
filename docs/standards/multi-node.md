{#multi-node title="Multi-node" order=110 appliesTo=src}
# Multi-node

One resource, an instance on each node, meshed by peers. Local where it must be, lazy where it can
be, never silently wrong.

{#one-resource-n-instances .must appliesTo=src}
## One resource = N node-local instances

One class. Each node runs its own instance; `peers` gives you the per-node handles.

``` ts
// one tag — not one-per-node
class Prices extends QueueResource.Tag<Prices>()("app/Prices", Job) {}

const perNode = yield* Resource.peers(Prices)
// { "node-a": handle, "node-b": handle, … } — keyed by node
```

{#readiness-per-node-local .must appliesTo=src}
## Readiness is per-node and local — never a cross-node hop

Readiness derives from a resource's **own** status and rolls up into that node's `/health`. Reaching
into a peer to decide your own readiness cascades one node's failure into its neighbours.

``` ts
// ✅ derived from this instance's own status
class Prices extends QueueResource.Tag<Prices>()("app/Prices", Job)
  .pipe(Resource.withReadiness((svc) =>
    Effect.map(svc.status.get, (s) => s.phase === "running"),
  )) {}

// ❌ readiness that hops to peers — a down neighbour drags this node down
Resource.withReadiness(() => Effect.map(Resource.peers(Prices), allReady))
```

{#fold-over-leaf-fields .must appliesTo=src}
## Fold over leaf fields; fleet views stay out of the fan-out

`peers` fans out to leaf handles. A `fleet`-marked field is *already* a combined view, so it's
excluded from the fan-out — folding over it would re-aggregate an aggregate. Fold leaves, and add
your own node explicitly.

``` ts
// a combined field is marked fleet → not re-fanned-out by peers
class Prices extends QueueResource.Tag<Prices>()("app/Prices", Job) {
  static readonly totalDepth = Resource.fleet(Resource.effect(Schema.Number))
}

// fold over leaves, self included explicitly (never silently)
const depthByNode = { ...(yield* Resource.peers(Prices)), [self.key]: local }
```

{#peers-are-lazy .must appliesTo=src}
## Peers are lazy and degrade to a partial mesh

`peersLayer` never connects eagerly. No url ⇒ skip that peer, never throw. Urls come from the node or
`Config` — never frozen into the contract.

``` ts
Resource.peersLayer(Prices, self, {
  nodes,
  url: (node) => Config.option(Config.string(`${node.key}_URL`)),
  //   Config.option → undefined skips a peer (partial mesh)
  //   a raw ConfigError fails the build loudly (misconfiguration)
})
```

