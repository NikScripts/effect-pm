---
"hyperlink-ts": minor
---

Add `Lookup.follow` / `followOptions` — hot dialer for one Lookup address across orchestrated A→B ownership replace (build-then-swap; `RpcClientError` retry; `Policy.streamGap`). `Lookup.client` stays static. Shared dial helpers live in `internal/dialFollow`.
