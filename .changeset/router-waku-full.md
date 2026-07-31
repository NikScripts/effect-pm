---
"hyperlink-ts": minor
---

One Router `Service`, two layers: lite `make`/`memory`/`history` and Waku (`hyperlink-ts/ui/Router/waku` → `Router.waku` + unified `Provider` that accepts a lite `Service` or Waku binding). Optional `waku` peer. Owned mode/kind discriminants are PascalCase (`Memory`/`History`/`Waku`, Target `Group`/`Leaf`/…). Fix catalog `match("/")` for home routes. GroupNav stays on top — not inside Router.
