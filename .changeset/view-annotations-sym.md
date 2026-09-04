---
"last-ts": minor
"hyperlink-ts": patch
---

**View handle slots:** Prototype metadata stamps under `View.annotationsSym` — not `Tag.annotations`. **`View.annotations(tag)` is an Effect**; sync peek is `View.getAnnotations(tag)` (client / builders). Factory brand `View.kind` (`"last-ts/View"`) stamps under `Last.kindSym`; read with `Last.kindOf(tag)`. New subpath `last-ts/Last`.
