---
"hyperlink-ts": minor
---

Track D v1 — `Hyperlink.lookupClient` closes the A→B dial gap for Effect RPCs.

- **Build-then-swap:** the next dial is built before the prior client scope is closed; a failed build keeps the prior dial (and logs a warning).
- **Transparent retry:** Effect methods that fail with `RpcClientError` resolve/adopt once (or wait briefly for a successful rebind), then retry **once** on the new dial. App-declared errors and `ProtocolMismatch` are not retried. Streams are not auto-retried.
- Cutover recipe unchanged: B Directory-visible (and/or Advice-prefer B) before `Node.shutdown(A)`.
