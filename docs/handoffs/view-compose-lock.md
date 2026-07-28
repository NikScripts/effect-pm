# View compose — LOCKED (owner 2026-07-27)

**Branch:** `cursor/tui-dashboard-parity-125f`  
**Bar:** tough but lightweight — best quality, no kit bloat.

Owner overrides on lineage URL + F1 sizes-vs-content; everything else = prior recommendations.

---

## Locked

### A. Chrome vs Navigator — **split (B)**

- **`Chrome`** — layout only: `width`, `selected`, `cols`, `rows`, `editMode`
- **`Navigator`** — `Context.Service` + Layer: `open` / `back` / path / overlays
- Skins read nav via `useNavigator()`, not callback props

### B. Matcher — **kit `Card` for Group + leaf**

- Group = family skin (`View.bind(Group.kind, WebGroupCard)`); matcher is `ui.Card` / `useMatch().Card`
- No `View.Member`; no `Cell` group fork
- `Navigator.open(member: GroupTag | LeafTag)`

### C. `View.compose` — **sugar over `View.react` + Navigator**

- No second registry; no `runtime` inside compose (W4 — `RuntimeProvider` outside)
- Returns `{ Provider, Grid, Outlet, for, data?, …react kit }`
- Batteries `<Dashboard />` **HOLD** until compose is boring

### D. Types

- Member = what `Group.isGroup` narrows (`Group | LeafTag`)
- Kit `Card` accepts Group tags once Group skin is provided

### E. Path = **member short names** (owner override)

Not wire keys. Not `encodeURIComponent(fullKey)`.

Parent stamps members by object key; that key is the URL segment:

```ts
class ServicesHub extends Group.Tag<ServicesHub>("hub/ServicesHub")({
  Nwsl: NwslGroup,  // ← segment "Nwsl"
}) {}

class NwslGroup extends Group.Tag<NwslGroup>("app/nwsl/NwslGroup")({
  HttpApi: NwslHttpApiClient,  // ← segment "HttpApi"
}) {}
```

Browser:

```text
/Nwsl/HttpApi
```

```ts
interface Navigator {
  /** Short-name path for URL / crumbs — ["Nwsl", "HttpApi"] */
  readonly path: ReadonlyArray<string>
  /** Wire keys when observe needs them — separate from URL */
  readonly wireLineage?: ReadonlyArray<string>
  readonly open: (member: GroupTag | LeafTag) => void
  readonly back: () => void
}

Navigator.toHref(["Nwsl", "HttpApi"])  // "/Nwsl/HttpApi"
Navigator.history(ServicesHub)         // web
Navigator.memory(ServicesHub)          // tests / TUI / embed
```

Cards never touch History.

### F. Sizes vs content (owner override on F1)

**ViewKind = building-block sizes** (unchanged):

```ts
type ViewKind = Data.TaggedEnum<{ Card: {}; Detail: {}; Page: {} }>
// ViewKind.Card() / .Detail() / .Page()
```

**Content** fills those sizes — schedule, logs, queue body, Group card, etc. can each ship:

- a `card` skin
- a `detail` skin
- a `page` skin
- optionally one component that **carries all three** and can resize
- plus any extra skins via `View.only` / additional binds

```ts
// Daemon schedule content → all three sizes
View.bind(Daemon.kind, ScheduleCard)    // card
View.bind(Daemon.kind, ScheduleDetail)  // detail
View.bind(Daemon.kind, SchedulePage)    // page

// or a pack that provides all three + resize host
View.bind(Daemon.kind, SchedulePack) // Pack.Card / .Detail / .Page internally
```

**Not** new ViewKinds named `logs` / `schedule`.  
Navigator may still say `openLogs(tag)` / `openSchedule(tag)` — that means “show this tag’s **page** (or detail) skin for that content,” not a fourth kind.

**F2:** HealthBoard / NodeDetail stay **shell-owned** for v1.

### G. Observe door — **superseded shape**

- Interim Eng’d: `ui.data.queue` / `.daemon` / … on compose (guide [`../guides/view-data.md`](../guides/view-data.md))
- **Preferred (standard):** thin handles + free helper `observe(tag)` ([`../standards/principles.md#handles-stay-thin`](../standards/principles.md#handles-stay-thin)). No methods on Tag; no noun menu on the kit.
- Same `*Bundle(runtime, tag)` internals; RuntimeProvider stays shared `ui/runtime`

### H. Migration

- `forKey` / `withEntries` → `View.only(tag, Comp)`
- `ViewPack.null` **later** (not first slice)
- Web + TUI **same slice**

### I. Navigator defaults

| Case | API |
|---|---|
| Web shell | `Navigator.history(group)` |
| Tests / embed / TUI | `Navigator.memory(group)` |

### J. Detail peel

| Piece | Home |
|---|---|
| Back + title | Shell (Outlet) |
| Badges / charts / controls | Detail skin |
| LogBox / schedule fullscreen | Shell until that content has a `page` (or detail) skin wired through Outlet |

First peel = header/body split; page-sized logs/schedule content follows.

### K. Non-goals (this arc)

- Kit batteries `Dashboard` = compose — **HOLD**
- Client adapters (`Hyperlink.atom` / TanStack / Promise) — parallel
- Desktop tabs / real multi-match pager — later
- Wild UI (⌘K, PiP, scrubber) — out of library scope

### L. Acceptance

1. Group opens via kit `Card` + Navigator — no `Cell` group fork  
2. URL path = short member names (`/Nwsl/HttpApi`)  
3. Default family Details body-only; shell owns back/title  
4. `View.compose` runs hyperlink-web + TUI dashboard  
5. WorkerPool example → `View.only` — **done** (`Dashboard views=` / hyperlink-web)  
6. ViewKind stays `card | detail | page`; schedule/logs are **content** that fills sizes  
7. Tests: `Navigator.memory` + Group card + short-name path + missing skin `R=never`

**Changeset:** minor if `Chrome` drops nav callbacks; migration → `useNavigator()`.

---

## App shape (batteries Dashboard)

```tsx
// worker-pool-card.tsx
export const layer = View.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(Layer.succeed(WorkerPoolCard, WorkerPoolCardView)),
)

// app.tsx — Dashboard merges views under shipped skins + View.base
<Dashboard runtime={runtime} group={ServicesHub} views={layer} />
```

Compose-only (no batteries shell) still looks like:

```tsx
const ui = View.compose({
  views: Layer.mergeAll(
    UiDashboardViews.layer,
    View.only(WorkerPool, WorkerPoolCard),
  ).pipe(
    Layer.provideMerge(WebDashboardViews.skins),
    Layer.provideMerge(View.base),
  ),
  navigator: Navigator.history(ServicesHub),
})
```

Open Nwsl → HttpApi → browser shows `/Nwsl/HttpApi`.
