---
"hyperlink-ts": patch
---

**Hyperlink.ws relative verify:** `Hyperlink.ws(Node, { url: "/rpc" })` on an addressed multi-protocol node no longer mis-classifies the same-origin path as Http GET (or fails the relative-url skip). Relative overrides skip verify outside the browser; with `location` they probe the resolved `ws(s)://` url.
