---
"hyperlink-ts": minor
---

**Advanced-authoring surface: `BuiltHyperlink` → `Driver`; `ServedHyperlink` demoted to `@internal`.**

The pre-provide impl bundle used when building a custom kind is renamed off the old internal brand:

| Before | After |
|---|---|
| `Hyperlink.BuiltHyperlink<S, R>` (type) | `Hyperlink.Driver<S, R>` |
| `Hyperlink.builtHyperlink(tag, impl, ctx)` | `Hyperlink.driver(tag, impl, ctx)` |
| `Hyperlink.isBuiltHyperlink(u)` | `Hyperlink.isDriver(u)` |
| `Hyperlink.builtHyperlinkSym` | `Hyperlink.driverSym` |

`Hyperlink.ServedHyperlink`, `Hyperlink.ServedHyperlinks`, and `Hyperlink.servedHyperlinksLayer` — the
served-resources registry consumed only by the transport servers — are demoted from `@public` to
`@internal`. They remain exported for cross-module use but are no longer part of the documented public
surface; do not depend on them.
