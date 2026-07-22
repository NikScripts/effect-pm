---
"hyperlink-ts": minor
---

Ship **`@nikscripts/effect-pm/tui`** and a shared UI core. The reactive React binding (`RegistryProvider` / `useAtomValue` / `useAtomSet` / `useAtomMount`) now lives once in `src/ui/atom-react` and is shared by both renderers — Ink is React, so the same hooks drive a terminal tree. `/tui` re-exports it plus composable terminal primitives — `bar`, `spark`, `compact`, `fmt`, `displayName`, `blankBorder`, and a `Status` theme (`statusColor` / `statusIcon`) — that you assemble into your own Ink widgets (composable pieces, not a generic auto-renderer). No new required deps; `/web` still re-exports the binding, so its consumers are unaffected.
