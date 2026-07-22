---
"hyperlink-ts": minor
---

**`Resource.peersLayer(tag, self, { url })` — override peer urls without freezing them into the host
contract.** Each `Host.url` stays the default (the standard — the host carries how to reach it); the
optional resolver `url: (host) => Effect<string | undefined>` overrides per host, falling back to
`Host.url` when it returns `undefined`. So env-specific ports, tunnels, or urls from Effect `Config`
don't have to be hardcoded into the (browser-safe) host def:

```ts
Resource.peersLayer(FleetDatabase, NwslHost, {
  url: (host) => Config.string(`PEER_URL_${host.key}`).pipe(Config.option, Effect.map(Option.getOrUndefined)),
})
```

The resolver's **error and requirements flow to the layer** (typed): a `Config`-backed resolver
surfaces a `ConfigError` as a typed layer-build failure (fail-fast on a misconfigured url), or use
`Config.option` to skip a missing one. A host that resolves to no url is **skipped** — a partial mesh,
never a throw. Fully back-compatible: omit `options` and `peersLayer` reads `Host.url` exactly as before.

Addresses wow-sports finding #2 (config/runtime peer urls for `peersLayer`).
