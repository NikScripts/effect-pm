# View compose — lock sheet (Agent G)

**Status:** owner answers in place. Blank = take the recommendation.  
**Branch:** `cursor/tui-dashboard-parity-125f`  
**Steal-first:** relocate Dashboard pieces onto View; invent only where noted.

---

## A. Chrome vs Navigator

### A1. Who owns navigation?

Today `View.Chrome` mixes layout hints with nav callbacks:

```ts
// ships today
export interface Chrome {
  readonly width?: number
  readonly selected?: boolean
  readonly onBack?: () => void           // nav
  readonly onOpenSchedule?: () => void   // nav / overlay
  readonly cols?: number
  readonly rows?: number
}
```

**Options**

| | |
|---|---|
| **A** | Keep nav on `Chrome` (`onBack`, add `onOpen`) — minimal churn |
| **B** | Split: `Navigator` service = open/back/lineage/overlays; `Chrome` = layout only |

**Recommended: B**

```ts
// Chrome — layout only (TUI cell width, selection, Ink metrics)
export interface Chrome {
  readonly width?: number
  readonly selected?: boolean
  readonly cols?: number
  readonly rows?: number
  readonly editMode?: boolean
}

// Navigator — parent-owned navigation (Context.Service + Layer)
export interface Navigator {
  readonly path: ReadonlyArray<string>
  readonly lineage: ReadonlyArray<string>
  readonly open: (member: GroupTag | LeafTag) => void
  readonly back: () => void
  readonly openLogs: (tag: LeafTag) => void
  readonly openSchedule: (tag: LeafTag) => void
}
```

Skin usage:

```tsx
const GroupCard: View.ViewComponent = (props) => {
  const nav = useNavigator()
  return (
    <button type="button" onClick={() => nav.open(props.tag)}>
      ▸ {props.name}
    </button>
  )
}

// shell
<View.ChromeProvider value={{ width: 42, selected: true }}>
  <Navigator.Provider>   {/* or Layer-built context */}
    <View.Card tag={Wnba} name="Wnba" />
  </Navigator.Provider>
</View.ChromeProvider>
```

**Your answer:**

---

### A2. How do skins read Navigator?

**Options**

| | |
|---|---|
| **A** | Pass `onOpen` / `onBack` as React props on every card (today’s Dashboard `Cell`) |
| **B** | `useNavigator()` over a `Context.Service` Layer (same seam as View skins / W13) |

**Recommended: B** — props don’t compose (who wins `onOpen` when nesting?). Layers do.

```ts
export class Navigator extends Context.Service<Navigator, NavigatorApi>()(
  "hyperlink-ts/ui/Navigator",
) {}

const navLive = Navigator.history(ServicesHub)
// View.compose provides it; skins call useNavigator()
```

**Your answer:**

---

## B. Matcher naming

### B1. One matcher for Group + leaf?

Today Dashboard forks:

```tsx
// ships — Cell special-case
if (Group.isGroup(member)) return <GroupCard … onOpen={…} />
return <View.Card tag={leaf} … />
```

**Options**

| | |
|---|---|
| **A** | `View.Member` for Group∪leaf; `View.Card` stays leaf-only |
| **B** | `View.Card` for both — Group is just another family skin (`View.kind(Group.kind, WebGroupCard)`) |

**Recommended: B**

```ts
const views = Layer.mergeAll(
  View.group(ServicesHub),
  View.kind(Group.kind, WebGroupCard), // same Card matcher
  WebDashboardViews.layer,
)
const ui = View.react(views)

// Grid — no fork
{members.map(({ tag, name }) => (
  <button type="button" className="contents" onClick={() => nav.open(tag)}>
    <View.Card tag={tag} name={name} />
  </button>
))}
```

**Your answer:**

---

### B2. Where does `GroupTag | LeafTag` live?

**Recommended:** on `Navigator.open` / Grid helpers — not a second View export.

```ts
nav.open(Wnba)           // Group
nav.open(BoxScoreQueue)  // leaf
// View.Card already takes tag: LeafTag today → widen to GroupTag | LeafTag
```

**Your answer:**

---

## C. `View.compose`

### C1. Sugar or new subsystem?

**Recommended:** thin sugar over `View.react(views)` + Navigator layer. **No second registry.**

```ts
// conceptual
View.compose({ views, navigator }) = {
  ...View.react(views),
  Provider: merge(ViewProvider, NavigatorProvider),
  Grid,
  Outlet,
}
```

**Your answer:**

---

### C2. Does compose take `Atom.runtime`?

**Recommended: No.** W4 — View Layer ≠ Atom runtime.

```tsx
// correct
<RuntimeProvider runtime={runtime}>
  <ui.Provider>
    <ui.Grid />
    <ui.Outlet />
  </ui.Provider>
</RuntimeProvider>

// wrong — don’t bury runtime inside compose
View.compose({ views, navigator, runtime })
```

**Your answer:**

---

### C3. What does compose return?

**Recommended:**

```ts
const ui = View.compose({
  views: Layer.mergeAll(View.group(Hub), WebDashboardViews.layer),
  navigator: Navigator.history(Hub),
})

ui.Provider   // View registry + Navigator
ui.Grid       // cards for current group members (incl. Group cards)
ui.Outlet     // detail | logs | schedule from navigator
ui.for(tag)   // { Card, Detail, Page, … } bound flip (ships)
ui.data?.(tag) // see G — optional same slice or follow-up
// plus existing react kit: resolve, keys, groupDash, …
```

**HOLD** renaming batteries `<Dashboard />` until this is boring.

**Your answer:**

---

## D. Types

### D1. Member type for `open` / Grid

**Recommended:** whatever `Group.isGroup` already narrows — roughly:

```ts
type MemberTag = Group.AnyGroup | LeafTag
```

Never `unknown` on the public Navigator API.

**Your answer:**

---

### D2. Does `View.Card`’s `tag` prop accept Group?

**Recommended: Yes**, once Group family skin is provided. Missing Group skin → same as any missing skin (`View.react` `R = never` / fallback policy W3).

```tsx
<View.Card tag={Wnba} name="Wnba" />
<View.Card tag={BoxScoreQueue} name="BoxScoreQueue" />
```

**Your answer:**

---

## E. LineagePath

### E1. Route identity = wire lineage keys?

Logs / status already speak keys like `wnba/BoxScoreQueue`.

**Recommended: Yes** — one address space for UI + observe.

```ts
nav.lineage
// ["hub/ServicesHub", "hub/Wnba", "wnba/BoxScoreQueue"]
```

**Your answer:**

---

### E2. URL encoding (keys contain `/`)

**Options**

| | |
|---|---|
| **A** | Join with `/` and hope (broken) |
| **B** | Each lineage entry = one URI segment, `encodeURIComponent` |
| **C** | Query param `?l=json` |

**Recommended: B**

```ts
// lineage → href
["hub/ServicesHub", "hub/Wnba", "wnba/BoxScoreQueue"]
// → "/hub%2FServicesHub/hub%2FWnba/wnba%2FBoxScoreQueue"

Navigator.toHref(lineage)
Navigator.fromLocation(location.pathname, rootGroup)
```

**Your answer:**

---

### E3. Who touches History?

**Recommended:** only `Navigator.history(group)`. Cards never import History / `useGroupRoute`.

```ts
Navigator.history(ServicesHub)  // batteries shell / web
Navigator.memory(ServicesHub)   // tests, embed, TUI path state
```

**Your answer:**

---

## F. Overlay kinds

### F1. logs / schedule — new `ViewKind` or overload `page`?

**Options**

| | |
|---|---|
| **A** | Overload `page` (“page means logs sometimes”) |
| **B** | Extend: `card \| detail \| page \| logs \| schedule` |

**Recommended: B**

```ts
View.kind(WorkPool.kind, QueueLogsView)      // kind: "logs"
View.kind(Daemon.kind, DaemonScheduleView) // kind: "schedule"

// navigator
nav.openLogs(BoxScoreQueue)      // Outlet → View match kind "logs"
nav.openSchedule(LiveScorePoller)
```

**Your answer:**

---

### F2. HealthBoard / NodeDetail — View or shell?

**Recommended:** shell-owned for v1 (don’t force View onto node/health axis).

```tsx
// Outlet handles resource detail + logs + schedule
// Dashboard shell still mounts HealthBoard / NodeDetail overlays
```

**Your answer:**

---

## G. `ui.data`

### G1. New data model or existing bundles?

**Recommended:** door to existing bundles — no parallel atoms.

```ts
// today
const bundle = queueBundle(runtime, BoxScoreQueue)

// compose
const box = ui.data(BoxScoreQueue)
// ≡ queueBundle(useRuntime(), BoxScoreQueue)
useAtomValue(box.status)
```

**Your answer:**

---

### G2. Where does `data` live?

**Options**

| | |
|---|---|
| **A** | On `View.react` kit |
| **B** | On `View.compose` only (needs RuntimeProvider in tree) |
| **C** | Separate `View.data(runtime, tag)` helper |

**Recommended: B** (or **C** if we want headless without compose). Lean **B** for app DX; add **C** if tests want it without Provider.

```tsx
const ui = View.compose({ views, navigator })
const box = ui.data(BoxScoreQueue) // reads RuntimeProvider context
```

**Your answer:**

---

## H. Migration / packs

### H1. `forKey` → `View.only`?

Today:

```tsx
const widgets = withEntries(base, [forKey(WorkerPool.key, WorkerPoolCard)])
<Dashboard widgets={widgets} … />
```

**Recommended:**

```ts
const views = Layer.mergeAll(
  WebDashboardViews.layer,
  View.only(WorkerPool, WorkerPoolCard),
)
const ui = View.compose({ views, navigator: Navigator.history(ServicesHub) })
```

Dual-path only during peel; then Dashboard happy path drops `widgets={…}`.

**Your answer:**

---

### H2. `ViewPack.null` in first Eng slice?

**Recommended: No** — after compose + Group card + Detail peel.

```ts
// later
View.react(Layer.mergeAll(View.group(Hub), ViewPack.null, binds))
```

**Your answer:**

---

### H3. Web + TUI same slice?

**Recommended: Yes** — Group card skin + compose parity, or it isn’t done.

**Your answer:**

---

## I. Navigator defaults

| Case | Recommended |
|---|---|
| Batteries web shell | `Navigator.history(group)` |
| Tests / embed / TUI | `Navigator.memory(group)` |
| Hash router, etc. | Not until something hurts |

```ts
// test
const ui = View.compose({
  views: testViews,
  navigator: Navigator.memory(ServicesHub),
})
nav.open(BoxScoreQueue)
expect(nav.lineage).toEqual([…])
```

**Your answer:**

---

## J. Detail peel

### J1. What stays shell vs skin?

| Piece | Recommended home |
|---|---|
| Back button / title row | **Shell** (Outlet chrome) |
| Status badges / charts / controls | **Skin** (detail body) |
| LogBox | **Shell** until `logs` kind (F1) |
| Schedule fullscreen | **Shell** until `schedule` kind (F1) |

```tsx
// Outlet (shell)
<header>
  <button onClick={() => nav.back()}>←</button>
  <h1>{name}</h1>
</header>
<View.Detail tag={tag} />   {/* body only */}
<LogBox … />                {/* until logs kind */}
```

**Your answer:**

---

### J2. First peel includes LogBox → `logs` kind?

**Recommended: No** — peel header/body first; `logs` / `schedule` kinds follow once Outlet exists.

**Your answer:**

---

## K. Non-goals (this Eng arc)

| Item | Recommended |
|---|---|
| Kit batteries `<Dashboard />` re-export as compose | **HOLD** |
| `Hyperlink.atom` / TanStack / Promise adapters | Parallel — not blocking |
| Desktop tabs / real multi-match pager | Later (stub stays) |
| Wild UI (⌘K, PiP, scrubber, pin) | Out of library scope |
| Force View onto HealthBoard / NodeDetail | No (F2) |

**Your answer (overrides):**

---

## L. Acceptance & release

### L1. Done when

1. Group opens via `View.Card` + Navigator — **no** `Cell` group fork  
2. Default family Details are body-only; shell owns back/title  
3. `View.compose` runs **hyperlink-web** and **TUI dashboard**  
4. WorkerPool example uses `View.only`, not `forKey`  
5. Tests: `Navigator.memory` + Group card match + missing skin still `R = never`

**Your answer:**

---

### L2. Changeset

**Recommended: minor** if `Chrome` drops `onBack` / `onOpenSchedule` (breaking for chrome readers); migration: use `useNavigator()`. Patch-only if we keep chrome nav callbacks as deprecated aliases for one release.

```md
---
"hyperlink-ts": minor
---

**View compose:** `Navigator` Context service; `Chrome` layout-only; Group family
`View.Card`; `View.compose({ views, navigator })`. `Chrome.onBack` /
`onOpenSchedule` removed — use `useNavigator()`.
```

**Your answer:**

---

## Quick “all recs” reply

If you agree with every recommendation above, reply:

```text
all recs
```

Otherwise paste section overrides, e.g.:

```text
A1 B (as rec)
F1 A — overload page for now
F2 HealthBoard as View.card later
L2 patch + deprecate Chrome nav for one release
```
