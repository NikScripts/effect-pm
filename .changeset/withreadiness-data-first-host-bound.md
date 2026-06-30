---
"@nikscripts/effect-pm": patch
---

**`withReadiness` data-first overload now also accepts host-bound tags.** The earlier fix named `HostBoundTag` only in the data-last (`.pipe`) overload; the data-first `Resource.withReadiness(tag, fn)` overload still constrained to `ResourceTag<any, any>`, so passing a host-bound tag value tripped `TS2345`. Both overloads now name `| HostBoundTag<any, any, any>`. (Note: the supported way to attach readiness to a host-bound tag remains the data-last form — `Tag()(…, { host }).pipe(Resource.withReadiness(fn))` — which is what the contracts and the dashboard use.)
