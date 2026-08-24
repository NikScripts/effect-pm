---
"hyperlink-ts": minor
---

Add Launcher app already-up Policy: `spawn` / default `up` fail with `NodeAlreadyUp` when the dial target is Ready; opt-in `alreadyUp: "adopt"` on `up` (or per `SpawnSpec`) skips spawn without a Handle. Bare skip rejected; never implies migration or Directory steal.
