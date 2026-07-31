# Owned string casing — parked for owner

**Branch:** `cursor/view-withsize-types-125f`  
**Rule:** [`docs/standards/types-and-naming.md`](../standards/types-and-naming.md#owned-string-literals-pascalcase)

Agent G is enforcing PascalCase owned discriminants where the call is clear.
Items below need an owner decision before Eng.

## Parked

### 1. `Target.view` vs URL path segments

Today `view: "logs" | "schedule" | "health"` is both a UI discriminant **and** the
literal path segment (`/Nwsl/HttpApi/logs`). Paths must stay lowercase (preserve
referent). Options:

| Option | Meaning |
|--------|---------|
| **A** | Keep `view` as path segment (lowercase) — not under the PascalCase rule |
| **B** | Split: `view: "Logs" \| …` + separate path token / key |
| **C** | Drop `view`; derive from last path key only |

Same dual-use in `groupAsRoutes`, `uiGroupRoutes`, `GroupNav`, `View` / shells.
Also `web/DashboardShell` `view: "main" \| "logs" \| "schedule"`.

### 2. Presentation / domain-echo unions

- TUI `Status` / `Priority` echo WorkPool `phase` strings (`running` / `off` / …) —
  **preserve** until WorkPool phases themselves PascalCase
- Effect log level names in filters (`info` / `warn` / `error`) — preserve referent
- Chart window **labels** (`"1m"`, `"all"`) — user-facing display strings

`web/widgets` chart `source` Eng'd to `History` / `Trend`; log min sentinel `All`.

### 3. Large domain renames (wire / Spec)

- Hyperlink value/ref markers: `"value" \| "ref"` (type-level Spec — huge blast)
- WorkPool modes/reasons: `"drain"`, `"finishActive"`, `"dead-lettered"`, …
  (engine / store rows may persist these)

Do **not** Eng without a dedicated cutover.

### 4. `Route.Href` brand

Tried `effect/Brand` on `urlBuilder` returns — UrlBuilder types collapsed to
`never` in `.test-d.ts`. Reverted. Next: hand-rolled brand or Brand after proving
UrlMethod inference, then tighten `go` / `Link` off bare `string`.

## Done this track

**UI:** Router `Memory`/`History`/`Waku`; Target `kind`; path tokens; WidgetEntry;
MemberKind `Group`/`Unknown`; TUI chrome `Normal`/`Command`; debug-console
`Idle`/`Ok`/`Fail`.

**Also Eng'd (clear owned reasons / tags):**

- `logScope` `All` / `Group`
- `ResolvedTagListenTarget` `Node` / `Nameless` / `TagNodeError`
- `LookupClientError.reason` + listen-tag reasons `Missing` / `Ambiguous`
- `EffectFnMissingPayload.reason` `Missing` / `Void` / `EmptyFields`
- `SharedRoutingError.reason` `MissingKey` / `UnknownKey`
- `Daemon.ScheduleMode` `Inline` / `Reference`
- `scripts/mark-the-surface-check` reasons `Missing` / `Both` (`public`/`internal`
  kept — they name the JSDoc tags)
