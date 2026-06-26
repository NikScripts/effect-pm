---
"@nikscripts/effect-pm": patch
---

`@nikscripts/effect-pm/web`: `useAtomValue` now mounts the atom for the component's lifetime (not only via `useSyncExternalStore`'s subscribe). A cold stream atom (status / metrics / logs) starts and forces its runtime layer to build on render, instead of leaving a panel blank until another mount — e.g. a control button — nudges the runtime.
