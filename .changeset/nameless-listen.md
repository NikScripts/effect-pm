---
"@nikscripts/effect-pm": minor
---

**Nameless `Node.listen([serve…])`** — pass only a serve list (or one serve layer): mints an address-less anonymous Node, claims at Lookup (D7), binds ipc, and bootstraps default Lookup. Dial with `Resource.clientLocal`. Options: `NamelessListenOptions` (`lookupPath` / `unlinkLookup` + usual listen knobs). Named `Node.listen(Worker, [serve…])` unchanged.
