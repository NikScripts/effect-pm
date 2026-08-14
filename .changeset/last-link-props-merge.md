---
"last-ts": patch
---

`Last.link` merges wrapped-component props with link-channel props: link keys (`to` / `out` / path params / anchor chrome) stay on the anchor; the rest go to the component. Dropped `Record<string, any>` on the public result type.
