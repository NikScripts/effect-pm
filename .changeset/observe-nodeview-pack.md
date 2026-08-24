---
"hyperlink-ts": patch
---

Move Node observe atom construction into `ui/nodeViewPack`; `NodeView.bind` / `.use` and `nodeStatusBundle` are thin wraps (NodeRef is not a Tag, so this stays bind/use — not `Observe.use`).
