---
"last-ts": minor
---

**Typed Views (`last-ts/jsx-runtime` + `View.nest`):** `View<Props, R>` with `"jsxImportSource": "last-ts"`. JSX *syntax* is a TS black box for `R`; use **`View.nest(Child, (Child) => …)`** to merge child `R` while rendering with normal JSX. Direct `jsx` / `jsxs` still return `Element<R>`. Runtime emits React elements; Radix / shadcn keep working. `View.gen` void → `() => null`.
