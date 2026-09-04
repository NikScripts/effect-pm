---
"last-ts": patch
---

`Server.fromPage` no longer imports client `View`/`AtomReact` into the RSC host path (fixes `React.createContext is not a function`). Effect page bodies run via `Effect.runPromise` on the host; soft-nav Outlet still uses `View.effect`.
