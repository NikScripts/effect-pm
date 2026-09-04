---
"hyperlink-ts": minor
---

**`hyperlink-ts/Dialers`** — live dial-session census sibling Tag (wire id
`hyperlink-ts/Lookup/Dialers`). `Lookup.client` / `follow` serve it;
`lookupClient` + directory `peersLayer` soft-register sessions.
`Lookup.planUpdate.clientsAtRisk` is now
`{ dialerId, serviceKey, target }` from `Dialers.listForTarget`, with
Advice-prefer fallback (`dialerId: "advice:…"`) when the census is empty.
`Launcher.restartSuccessor` stamps `Advice.prefer(B)` after `up(B)` by default
(`prefer: false` to skip) for sticky dual-serve before shutdown.
