---
"@nikscripts/effect-pm": patch
---

`@nikscripts/effect-pm/web` reactive binding fixes so panels aren't blank until you interact:

- `useAtomValue` now mounts the atom for the component's lifetime (not only via `useSyncExternalStore`'s subscribe), so a cold stream atom (status / metrics / logs) starts and forces its runtime layer to build on render.
- `useAtomSet` mounts its command atom (a `fn` atom only runs while active — otherwise `set` is a no-op / dead buttons).
- New `useAtomMount(atom)` — a subscribe-free keep-alive. Mount a runtime atom at the app root so the runtime layer stays built across navigation; otherwise tearing the last atom down between views disconnects it and the next view's cold streams start blank.
