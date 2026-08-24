---
"last-ts": minor
"hyperlink-ts": minor
---

**last-ts package (P0–P1):** new workspace package for Effect+React building blocks. Ships `Page` (file-router marks), `AtomReact` (registry + runtime providers/hooks), and `vite` (`fileRouter` + path emit/check). Root barrels real modules only.

**hyperlink-ts:** depends on `last-ts` (`workspace:*`); `ui/Page`, `ui/atom-react`, `ui/runtime`, and `vite/fileRouter` re-export from last-ts. Prefer `import * as Page from "last-ts/Page"` / `last-ts/AtomReact` / `last-ts/vite`.
