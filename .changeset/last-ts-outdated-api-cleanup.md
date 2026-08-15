---
"last-ts": major
"hyperlink-ts": major
---

**Breaking — last-ts API cleanup:** Removed View brand theater (`View.Component` / `Unresolved` / `ServicesOf` / `ProvidesOf` / `ViewPropsOf` / `ViewHandle` / `ViewHandleDefault` / `AnyView`); `View` is now an alias of `ViewFn`. Deleted Page stamp helpers (`Stamp` / `stampOf` / `renderModeOf`). Removed public `RouterClient` module (use `Route.urlBuilder`), public `RouterBuilder.resolveHandler` / `resolveRender`, and `Document.applyDocumentArgs` / `Page.remintStatic` from the public surface.
