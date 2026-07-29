# Open asks — priority queue

**Purpose:** Single place for unfinished product / DX / consumer asks. Priority order is owner-controlled; highest at the top. Agents walk one item at a time in chat — do not bury decisions only in this file.

**Rules:** Implemented / declined → remove the row (and delete the source handoff if it has nothing left). New unfinished asks from consumer findings land here instead of living forever as date-stamped one-offs.

---

## 1. Test doubles (`layerNoop`) for package-owned deps

**Area:** test DX for served stacks  
**Source:** wow-sports engine-serve adoption (was `2026-07-01-engine-serve-adoption-feedback.md`)  
**Status:** open — ship with the service, not a free-floating kit

Once deps are explicit in `R` (`serve` / edge provide), unit tests must supply a `Layer` for every ambient tag. Live layers are too heavy; consumers invent noops (they already have `ImportFlush.layerNoop` for *their* services).

**Ask:** where **hyperlink-ts** owns the service, ship a matching `layerNoop` (or equivalent inert layer) so consumers don’t hand-stub package deps.

**Rule:** a `layerNoop` lands **beside the service it stubs** when that service exists — not a generic “noop any Tag” helper. Consumer-owned tags stay consumer-owned stubs. Optional later: a fatter “test serve” kit is out of scope until a concrete owned service needs it.

**Inventory note (2026-07-14):** No package-owned ambient Tag today lacks a usable test layer (`Store.Service.layerMemory`, engine `layer` / `serve`, etc.). Leave this row until a concrete package service appears that needs an inert double.

Not a blocker. No `layerNoop` under `src/` today.

---

## Closed this pass

| Ask | Fate |
|-----|------|
| Dashboard widget plug-in seam | **Shipped** — `src/web/widget-registry.ts` (`forKind` / `forKey` / `withEntries` onto `base`; Agent C on `integration`) |
| Docs: when NOT to hoist `Effect.provide` to `serve` | **Shipped** — standards *Resources* (declare-don’t-provide) + the “when not to hoist” guidance in that rule |
| beta.22 `withReadiness` pipe TS2589 | **Fixed** — `PipeableTag` + type-hygiene [#54](https://github.com/NikScripts/effect-pm/pull/54) on `integration` |
