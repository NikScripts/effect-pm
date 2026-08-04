---
"hyperlink-ts": minor
"last-ts": minor
---

**Views size split:** `last-ts/View` and `hyperlink-ts/ui/View` are DI only (`Tag` / `Prototype` / `provide` / `Chrome`) — no `ViewKind`, Card/Detail/Page, Registry, bind, or compose. Dashboard size chrome + Registry + bind/only + react matchers + compose move to `hyperlink-ts/ui/Views` (`Views.Card.Service`, `Views.bind`, `Views.compose`, …). Migrate `View.Card` / `View.bind` / `View.compose` / `View.base` call sites to `Views.*`.
