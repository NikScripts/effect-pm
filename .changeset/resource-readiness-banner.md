---
"@nikscripts/effect-pm": minor
---

**Readiness on the resource detail pages.** A resource's detail page (queue / process / API) now shows an amber **degraded — &lt;root cause&gt;** banner under its header when it isn't ready — read from its host's `HostStatus` (the same SSOT the health board uses, via the new `resourceHostRef(tag)`). So a queue that's degraded because a dependency is down shows *why* right on its own page, not only in the health board. It renders **nothing while ready/connecting** (no wasted space — it only appears, pushing content down, on a problem) and nothing for a hostless (local) resource. New `/web` export: `ResourceReadinessBanner`; `data.resourceHostRef` / `data.tagWireKey` are now exported.
