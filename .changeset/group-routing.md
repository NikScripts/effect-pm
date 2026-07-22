---
"hyperlink-ts": minor
---

`@nikscripts/effect-pm/web`: add **`useGroupRoute(root)`** — URL routing that mirrors the `Group` tree. The path is the chain of member keys from the root (`ServicesHub → Wnba → ImportSchedule` ⇒ `/Wnba/ImportSchedule`), matched **case-insensitively** while the URL keeps the tree's casing; backed by the History API (deep links + back/forward). Renderer-agnostic — bind the grid/detail off `route.group` / `route.selected` and wire open/back to `route.open` / `route.back`. A selected leaf can carry a **sub-view** segment (`/Mail/logs` ⇒ `route.view === "logs"`) for per-resource pages like a fullscreen log viewer. The example mobile dashboard now navigates through it. (Hosting note: serve `index.html` for unknown paths so deep links resolve.)
