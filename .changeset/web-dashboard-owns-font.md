---
"hyperlink-ts": patch
---

`@nikscripts/effect-pm/web`: the dashboard now owns its font. It previously relied on a global `body { font-family: var(--font-mono) }` plus inheritance, so any consumer rule on an intermediate element — e.g. an `#root { font-family: … }` in their `index.html` (ID specificity) — overrode it and the dashboard rendered in the host app's font. `font-mono` is now declared on the dashboard's own root, so the widgets render monospace regardless of the host's `body`/`#root` font, while still honouring a consumer-defined `--font-mono` token.
