---
"hyperlink-ts": minor
---

Node cutover drain signal: `Status.phase` (`running` | `draining`), `Node.drain` / status `drain` RPC (idempotent), and fail-closed `yield` while draining so Lookup cannot steal a reachable draining Directory row.
