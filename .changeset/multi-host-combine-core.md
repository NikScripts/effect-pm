---
"hyperlink-ts": minor
---

**`@nikscripts/effect-pm/MultiHost` — combine a field across N instances of one resource.** The isomorphic core for multi-host resources (one shape, one instance per host): `combineQuery(peers, pick, combine)` gathers a query field from every host in a caller-supplied keyed peer map — each host's outcome captured as a `HostResult` (a down host is a failed `exit`, never a thrown gather) — then folds; `combineStream(peers, pick, transform)` combines a stream field. `Combine` ships ready-made folds (`sum` / `collect` / `byHost` / `successes` / `failures` / `mergeStreams`) that skip down hosts, while a custom fold sees the full per-host outcomes and decides the down-host policy itself. Pure and browser-safe — runs unchanged in a browser dashboard, a node/bun aggregator, or a CLI. (Slice 1 of the multi-host design; the contract field-kinds and serve/peer wiring build on it — see `docs/handoffs/multi-host-instances-decisions.md`.)
