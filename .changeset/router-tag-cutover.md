---
"hyperlink-ts": minor
---

Router / Route discriminant cutover: `Service.mode` → `Service._tag` (`Memory`/`History`/`Waku`); `Route.TargetValue` is a tagged sum (`Group`/`Leaf`/`LeafView`/`Health`) with `viewOf`/`memberOf`; PathToken uses `_tag`; drop redundant `WakuBinding.mode` and the lite `make` re-export from `Router/waku` (use `hyperlink-ts/ui/Router` for Memory/History).
