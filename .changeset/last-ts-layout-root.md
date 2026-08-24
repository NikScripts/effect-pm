---
"last-ts": minor
---

Add `last-ts/RootLayout` and View-shaped `Layout.make` / `Layout.provide` / `Passthrough`. `RouterBuilder.group` is now `(api, id, build)` only — page groups require `Layout.provide`; remove `{ layout: false }` and positional layout args.
