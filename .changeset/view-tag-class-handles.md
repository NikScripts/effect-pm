---
"hyperlink-ts": minor
---

**View handles:** `View.make` → **`View.Tag`** class Context.Service handles (`class PoolCard extends View.Tag<PoolCard>()(key, kind, spec) {}`), matching Daemon/Group Tags. Per-tag-key binder renamed **`View.tag` → `View.key`** (avoids colliding with `View.Tag`; do not say "resource"). Dropped phantom `ViewId<K>` — Layer `R` is the class Self.
