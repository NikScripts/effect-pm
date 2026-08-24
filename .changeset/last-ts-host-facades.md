---
"last-ts": minor
---

Apps never import `waku` — add `last-ts/config` (`defineConfig`) and `last-ts/server` (`createPages` + `adapter`) façades so the optional Waku peer stays inside the package. Dogfood registers RSC routes programmatically (no Waku fs-router / `getConfig`).
