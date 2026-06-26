---
"@nikscripts/effect-pm": patch
---

`@nikscripts/effect-pm/web`: add **`useViewTransition`** + **`viewTransitionStyle`** — animate a navigation state change with the browser's View Transitions API (a crossfade, plus a morph between any "before"/"after" elements that share a name), degrading to an instant update where unsupported. The example mobile dashboard adopts it for grid ↔ detail and group drill-down, morphing the resource title from its grid card into the detail header; honors `prefers-reduced-motion`.
