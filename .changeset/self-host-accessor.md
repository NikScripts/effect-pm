---
"@nikscripts/effect-pm": minor
---

**`Resource.selfHost(tag)` — the host key a multi-host instance runs as**, the same key its
`Resource.peers` are keyed by. For `Combine.byHost` folds (one row per host), so a resource's own logic
keys its **own** row without hand-threading the host key:

```ts
fleetStatus: Effect.gen(function* () {
  const self = yield* Resource.selfHost(FleetDatabase);
  const peers = yield* Resource.peers(FleetDatabase);
  const byHost = yield* combineQuery(peers, (p) => p.status, Combine.byHost);
  return { ...byHost, [self]: yield* ownStatus }; // own row, keyed consistently
})
```

Provided by `Resource.peersLayer(tag, self)` (now bundled — a mesh resource gets it for free) or
standalone `Resource.selfHostLayer(tag, self)` (with `peersFrom`, or when a resource keys per host
without a mesh). No transport, no failure path — just the identity.

Addresses wow-sports finding #1 (a "which host am I?" accessor for `byHost` folds).
