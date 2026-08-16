---
"last-ts": patch
---

**Fix View ↔ Last TDZ crash:** `kindSym` lives in `internal/kindSym` so `View` can stamp factory brands without importing `Last` (cycle was View → Last → link → Link → View → `Cannot access 'kindSym' before initialization`). Public `Last.kindSym` / `Last.kindOf` unchanged.
