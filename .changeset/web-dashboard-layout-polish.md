---
"@nikscripts/effect-pm": patch
---

`@nikscripts/effect-pm/web` dashboard polish: process controls stay a horizontal row at every width (only the queue controls go vertical, to flank the metric chart); card content stays top-aligned when the grid stretches a card to the row height (instead of a bare `<button>` centring its content in the slack); tighter log columns (time and level); and the metric chart gains a second dropdown to pick the latency series' time unit (ms/s/min/hr).

The group view now labels cards and the breadcrumb by the **member key** under which each parent group holds them (the nickname used for routing — e.g. `Nwsl`/`Wnba`), rather than the last segment of the tag's own key. Full-screen resource pages still use the tag's own key, since a resource doesn't know the nickname its group gave it. `useGroupRoute` now also returns the resolved `keys` (the member-key chain mirroring the path).
