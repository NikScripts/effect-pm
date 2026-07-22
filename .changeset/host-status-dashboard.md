---
"hyperlink-ts": minor
---

**Hosts in the dashboard.** The web dashboard now surfaces the hosts its resources are served on, read straight off the tags — no registry.

- **`Resource.hostOf(tag)`** — read a tag's bound `Resource.Host` (sibling to `kindOf`), so the dashboard derives its host list from the `Group` tree (`hostsOf`). New `/web`: `hostStatusBundle` / `useHostBundle` over each host's `HostStatus`, `HostBar`, `HostDetail`, `HostDots`, `leafByKey`.
- A **host-status "die"** sits in the header: one pip per host, coloured by that host's `HostStatus` (green ok / amber degraded / red down), barrel-stacked (3 → 1-over-2, etc.) and larger when there are fewer. Tap it for a **hosts panel** (status · uptime · ready/total); tap a host for its **full screen** — per-resource readiness **and** the host's live logs.
- Tapping a resource on a host page opens that resource's detail and **back returns to the host** (not up the group tree).
- The dashboard header was polished: title screen-centered on drilled-in pages (hexagon only at the root), the resource count rendered as a small negative-space circle, the tap hint moved to the bottom.
- The opt-in debug console got icon buttons + a copy-to-clipboard button that works over non-secure origins (LAN/Tailscale).

The example (`examples/resource-web`) is now a real **remote** dashboard — three hosts served over `serveAllHttp`, the browser a thin `Resource.client` (vite-proxied) — so the host features render live.
