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

### 2. Dashboard local UI unions (not `_tag` / `mode` / `kind` / `reason`)

- `web/DashboardShell` `view: "main" \| "logs" \| "schedule"`
- `web/debug-console` `copyState: "idle" \| "ok" \| "fail"`
- `web/widgets` chart `source: "history" \| "trend"`, log `min` levels
- TUI `Status` / `Priority` mirrors that may echo domain WorkPool phases

Recommend: rename fields to `_tag` / `mode` when they are true discriminants, then
PascalCase — or explicitly exempt “presentation labels” in the standard.

### 3. Large domain renames (public wire / schemas)

Clear owned `_tag`s still lowercase/camel in core (out of UI track; high blast):

- `Daemon.ScheduleMode`: `"inline" \| "reference"`
- Hyperlink value/ref markers: `"value" \| "ref"`
- WorkPool modes/reasons: `"drain"`, `"finishActive"`, `"dead-lettered"`, …
Do **not** Eng without a dedicated cutover — wire compatibility / store rows may
encode these strings.

## Done this track

**UI:** Router `Memory`/`History`/`Waku`; Target `kind`; path tokens; WidgetEntry;
MemberKind `Group`/`Unknown`; TUI chrome `Normal`/`Command`.

**Also Eng'd (clear owned reasons / tags):**

- `logScope` `All` / `Group`
- `ResolvedTagListenTarget` `Node` / `Nameless` / `TagNodeError`
- `LookupClientError.reason` + listen-tag reasons `Missing` / `Ambiguous`
- `EffectFnMissingPayload.reason` `Missing` / `Void` / `EmptyFields`
- `SharedRoutingError.reason` `MissingKey` / `UnknownKey`
- `Daemon.ScheduleMode` `Inline` / `Reference`
- TUI chrome `Normal` / `Command`; web debug-console `Idle` / `Ok` / `Fail`
- `scripts/mark-the-surface-check` reasons `Missing` / `Both` (`public`/`internal`
  kept — they name the JSDoc tags)

**Still parked:** Hyperlink `"value"`/`"ref"`; WorkPool drain modes & kebab
reasons; `Target.view` path dual-use; `Route.Href` brand (inference).
