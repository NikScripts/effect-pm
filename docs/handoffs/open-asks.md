# Open asks — priority queue

**Purpose:** Single place for unfinished product / DX / consumer asks. Priority order is owner-controlled; highest at the top. Agents walk one item at a time in chat — do not bury decisions only in this file.

**Rules:** Implemented / declined → remove the row (and delete the source handoff if it has nothing left). New unfinished asks from consumer findings land here instead of living forever as date-stamped one-offs.

---

## 1. Dashboard widget plug-in seam for custom resources

**Area:** `@nikscripts/effect-pm/web`  
**Source:** wow-sports services-hub (was `2026-07-01-dashboard-custom-resource-widgets.md` ask #1)  
**Status:** open — design before code

Custom `Resource.Tag`s (`Database`, `Import`, `EventManager`, …) with no known `Resource.kindOf` fall back to the **generic status card** (status fields + streams). That works. Rich per-type cards (queue / process / ApiMetrics) do not exist for consumer-defined shapes.

**Missing:** how `/web` picks a widget for a tag it does not statically know:
- by `kindOf`
- by spec-shape match
- by a consumer-registered widget map

Generic introspection is rejected. Widgets stay hand-crafted per type; the seam is how a consumer plugs theirs in.

**Not a blocker** for wow — the generic card already renders. Prerequisite shipped: `Resource.client(tag, host)` (beta.17).
