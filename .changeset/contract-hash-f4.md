---
"hyperlink-ts": minor
---

F4 `contractHash` on NodeStatus readiness + deep verify / default-on client.

- `NodeStatus.resources[].contractHash` stamped at serve from the tag Spec
- `Resource.contractHash(tag)` — client-side fingerprint (same algorithm)
- `verifyConnection({ deep: true, resource, contractHash })` → `ContractMismatch` on drift
- Addressed `Resource.client(tag, node)` / `clientHttp` default-on verify escalates to deep + F4 (NodeStatus clients stay tier-1)
- New error: `ContractMismatch { expected, actual, resource, node, url }`
- Nested default-on verify opted out where it deadlocks: `Lookup.client`, identity incumbent ping/yield, and `clientLayerForEndpoint` (identity loser / `lookupClient`)
