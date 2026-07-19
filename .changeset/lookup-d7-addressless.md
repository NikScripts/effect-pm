---
"@nikscripts/effect-pm": minor
---

**D7 vertical** — address-less listen, Lookup bootstrap, nodeless `lookupClient`.

- `Lookup.bootstrapDefaultLocal` — bind-or-dial default ipc (`unlink: false` by default so second process cannot steal the sock).
- `Lookup.Identity.resolve` — read a claim without claiming.
- `Resource.lookupClient(Tag)` — fail-closed dial via resolve then `nodesServing`.
- Address-less `Resource.listen(Node)` — mint ephemeral ipc path, claim `Node.key`, advertise; lose → `AddressLessClaimLost`.
- Identity claim endpoint = `ListenNode` or Tag-bound Node — **`{ self }` removed**.
- `Resource.Node.Prototype` + `.make(name, addr)` → constructible Node (`class East extends Proto.make(...) {}`).
  (Prototype nests on `Node` — not a top-level `Resource.Prototype`.)
