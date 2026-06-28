---
"@nikscripts/effect-pm": patch
---

`@nikscripts/effect-pm/web`: add **View Transitions** helpers — `ViewTransitionProvider`, `useViewTransition`, and `useViewTransitionStyle` — to animate navigation (a card morphs to fill the screen, then back) instead of cutting, degrading to an instant update where the API is unavailable.

Naming is **conditional**: only the element being navigated to/from carries a `view-transition-name` during a given transition (`transition(name, update)` + `useViewTransitionStyle(name)`), so everything else is captured as one image and grows/fades together — otherwise every named card would be lifted out and pop in at its final position. Names are sanitized to valid CSS idents (resource ids contain `@`/`/`). The example mobile dashboard adopts it for grid ↔ detail and group drill-down; honors `prefers-reduced-motion`.
