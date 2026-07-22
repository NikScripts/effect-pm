---
"hyperlink-ts": minor
---

**`Resource.make` for reusable impls, and host-free multiHost resources.**

- **`Resource.make(tag, impl)`** — anchor a **hoisted** implementation to its contract at the definition
  site. Inline impls at `layer` / `serverEntry` / `serve` are already typed; but the moment you extract one
  to a `const` (to share it across the local layer and a served entry, or across several serves) it loses
  that typing and the mistake surfaces far away at the serve call. `Resource.make` infers the tag's spec,
  constrains `impl` to its `ImplOf`, and returns it typed (autocomplete + errors where you write it).
  Overloaded for the `Effect`-form (`R`); runtime identity. Also exports **`SpecOf<T>`** so the no-helper
  `obj satisfies ImplOf<SpecOf<typeof Tag>>` route doesn't reach through internals.
- **Host-free multiHost.** `Resource.peersLayer(tag, self, { hosts })` now takes the fleet **at the use
  site**, so a shared multiHost resource can be defined host-free and exported — hosts are a deployment
  concern added where the resource is used. Falls back to the tag's baked-in `.multiHost([…])` set when
  omitted (backward-compatible).
