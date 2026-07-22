---
"hyperlink-ts": minor
---

**Two ergonomic helpers:**

- **`Resource.httpServer(serves, options?)`** — pass the `serve` layers as the first argument and it
  bundles the `provideMerge` + `servedResourcesLayer` boilerplate (and removes the `provideMerge`-vs-
  `provide` footgun): you list resources and provide only the platform (+ any shared dependency). The
  low-level `httpServer(options)` form is unchanged.

- **`Resource.fleetHealth(tag, pick, own)`** — the canned droplet-health fold: `pick` a leaf value from
  every peer, key it **by host** (`Combine.byHost`), and add this host's `own` value keyed by `selfHost`
  — the recurring `combineQuery(peers, pick, Combine.byHost)` + `selfHost` pattern in one call. A down
  peer is skipped (captured, never thrown); the only error/requirement is `own`'s.
