---
"last-ts": minor
"hyperlink-ts": minor
---

**Link handlers + View:** `last-ts/Link` — `Link.To` / `Link.Out` (`Context.Reference<Handler>`) and `Link.View` (`View.make` default `<a>`). `Router.link` / `Last.link` fulfill through them. Override with `Layer.succeed` on `Last.provider`, `RouterBuilder` compose (`provideMerge`), or trailing Layer on `Last.link`.
