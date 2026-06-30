---
"@nikscripts/effect-pm": minor
---

**Readiness on the resource detail pages.** Each resource's detail page (queue / process / API) now shows a readiness line under its header — green **ready**, or an amber **degraded — &lt;root cause&gt;** banner — read from its host's `HostStatus` (the same SSOT the health board uses, via the new `resourceHostRef(tag)`). So a queue that's degraded because a dependency is down shows *why* right on its own page, not only in the health board. New `/web` export: `ResourceReadinessBanner`; `data.resourceHostRef` / `data.tagWireKey` are now exported. Renders nothing for a hostless (local) resource.
