---
"last-ts": minor
---

**Typed JSX (`last-ts/jsx-runtime`):** nested JSX keeps services `R` — child → parent → component — via `Element<R>` / `View<Props, R>`. Set `"jsxImportSource": "last-ts"` (or a per-file pragma). Do **not** collapse `JSX.Element` to a non-generic alias (that restores erasure). Runtime still emits React elements; Radix / shadcn / plain components keep working. `View.gen` void → `() => null`. `View.stamp` / `View.ServicesOf` for the `R` channel.
