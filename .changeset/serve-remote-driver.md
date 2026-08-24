---
"hyperlink-ts": minor
---

Add `Hyperlink.serveRemoteDriver` — served-only mount for a `Driver` that preserves worker `R` on the Layer. Plain `serveRemote` stays `ServeRequirements`-inferred for object impls; Gate / Daemon / WorkPool / `serve` call the Driver path without toolkit retypes.
