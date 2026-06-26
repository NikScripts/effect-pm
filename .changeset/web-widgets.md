---
"@nikscripts/effect-pm": minor
---

Ship **`@nikscripts/effect-pm/web`** — a React widget library for building resource dashboards straight from the toolkit's `Tag`s. Queue and process cards, stat panels, metric charts, control buttons (with round-trip feedback) and live log streams, each driven by an atom bundle derived from a resource tag — no hand-rolled registry. A small Effect-atom binding (`effect/unstable/reactivity`) backs the same widgets in the browser and in an Ink TUI; the data layer is environment-aware, so the identical UI reads a local engine layer or a remote `Resource.client` over http without changes.

Also adds the worked examples that exercise it: a tag-driven web dashboard (mobile + desktop) and a matching Ink TUI dashboard over the same shared data layer, plus a `pnpm run example:session` tmux launcher that boots the example servers and both UIs in one place.
