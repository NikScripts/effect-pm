---
"hyperlink-ts": minor
---

Track D parity for directory-mode `peersLayer`.

- Peer dial install is **build-then-swap** (prior peer stays until the next dial
  succeeds; failed build keeps prior).
- Effect peer RPCs that fail with `RpcClientError` **retry once** after rebind
  (same contract as `lookupClient`). Streams are not auto-retried.
- Stable `peers[nodeKey]` facade identity across dial swaps.
