---
"last-ts": major
"hyperlink-ts": major
---

**Breaking — last-ts outdated API cleanup**

- Removed View brand theater (`Component` / `Unresolved` / peels / handles / `AnyView`); `View` ≡ `ViewFn`.
- Deleted Page stamp helpers (`Stamp` / `stampOf` / `renderModeOf`).
- Removed public `RouterClient`, `RouterBuilder.resolve*`, `Document.applyDocumentArgs`, `Page.remintStatic`.
- Dropped package exports `./server` and `./Router/waku` (use `last-ts/Waku` + `Last.provider`; host `createPages` is Waku host wiring, not product).
- Dropped public `Waku.setDefault` / `Waku.Provider` / `binding` — prefer `Last.provider(Waku.fromApi|layer)`.
- Deleted `Router.memory` / `Router.history` / `Router.unsafeService` — use `Memory.fromApi` / `History.fromApi` (Layers) or `Memory.service` / `History.service` (sync), plus `.layer` + `RouterBuilder` for SPA handlers.
- Deleted public `Page.Document` / `DocumentValue` / `DocumentApi` — write with `Page.document` + `last-ts/Document`.
