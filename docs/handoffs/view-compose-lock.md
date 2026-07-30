# View compose — LOCKED (owner 2026-07-27)

**Branch:** `cursor/tui-dashboard-parity-125f`  
**Bar:** tough but lightweight — best quality, no kit bloat.

Owner overrides on lineage URL + F1 sizes-vs-content; everything else = prior recommendations.

---

## Locked

### A. Chrome vs Router — **split (B)**

- **`Chrome`** — layout only: `width`, `selected`, `cols`, `rows`, `editMode`
- **`Router`** — `Context.Service` + Layer for catalog match, `go` / `to`, and history
- **`GroupNav`** — Group state plus `open` / `up` / URL page helpers over a Router

### B. Matcher — **kit `Card` for Group + leaf**

- Group = family skin (`View.bind(Group.kind, WebGroupCard)`); matcher is `ui.Card` / `useMatch().Card`
- No `View.Member`; no `Cell` group fork
- `GroupNav.open(root, router, member: GroupTag | LeafTag)`

### C. `View.compose` — **sugar over `View.react` + Router**

- No second registry; no `runtime` inside compose (W4 — `RuntimeProvider` outside)
- Returns `{ Provider, Grid, Outlet, for, data?, …react kit }`
- Batteries `<Dashboard />` **unheld** (2026-07-29) — public one-liner over compose + shell

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
interface GroupNavState {
  /** Short-name path for URL / crumbs — ["Nwsl", "HttpApi"] */
  readonly keys: ReadonlyArray<string>
  /** Wire keys when observe needs them — separate from URL */
  readonly wireLineage?: ReadonlyArray<string>
}

GroupNav.toHref(["Nwsl", "HttpApi"])  // "/Nwsl/HttpApi"
GroupNav.open(ServicesHub, router, NwslHttpApiClient)
GroupNav.up(ServicesHub, router)
router.back()
// Route catalog only — Group via asRoutes + fromEffect
Router.history(Route.make("dash").add(
  Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub)),
))
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
Router may still say `openLogs(tag)` / `openSchedule(tag)` — that means “show this tag’s **page** (or detail) skin for that content,” not a fourth kind.

**F2:** HealthBoard / NodeDetail are **Router root pages** — `/health`, `/health/<nodeId>` (`openHealth` / `openNode`). HyperService drill from the board stays a local stack (not a Group leaf path). `NodeStatusHost` remains for overlay embeds.

### G. Observe door

- **Eng’d:** `Observe.use(tag, *View.pack)` / `NodeView.use` ([`../guides/observe.md`](../guides/observe.md)) + `Hyperlink.atom` / `.query` / `.fn` ([`../guides/hyperlink-atom.md`](../guides/hyperlink-atom.md))
- Thin handles ([`../standards/principles.md#handles-stay-thin`](../standards/principles.md#handles-stay-thin)): no Tag methods; no kit noun menu
- **`Bundle.observe` / `ui.data.*` / `use*Bundle`:** **removed** (Phase 4)
- View Prototype `use` for component logic is **not** the observe door (later / optional)
- RuntimeProvider stays shared `ui/runtime`

### H. Migration

- `forKey` / `withEntries` → `View.only(tag, Comp)`
- `ViewPack.null` **later** (not first slice)
- Web + TUI **same slice**

### I. Router defaults

| Case | API |
|---|---|
| Web shell | `Router.history(site)` with `fromEffect(Group.asRoutes(group))` |
| Tests / embed / TUI | `Router.memory(site)` same pattern |

### J. Detail peel

| Piece | Home |
|---|---|
| Back + title | Shell (Outlet) |
| Badges / charts / controls | Detail skin |
| LogBox / schedule fullscreen | **Page skins** (`PoolPage` / `DaemonPage`) via `Match.Page` — Eng’d |

First peel = header/body split; page-sized logs/schedule **Eng’d**.

### K. Non-goals (this arc)

- Client adapters: Promise + atom/query/fn Eng’d; TanStack hooks — parallel
- Desktop tabs / real multi-match pager — later
- Wild UI (⌘K, PiP, scrubber) — out of library scope

### K2. Dashboard unhold peel (2026-07-29)

| Slice | State | Notes |
|------|-------|-------|
| **0** Unhold batteries | **Eng’d** | `<Dashboard />` + `DashboardLayer.forCompose` + `View.compose` + `DashboardShell` supported |
| **1** Top bar / detail chrome | **Eng’d** | `DashboardTopBar` + web `DashboardDetailChrome` public |
| **2** Node status | **Eng’d (Router pages)** | `/health` + `/health/<nodeId>`; `NodeStatusHost` for overlay embeds |
| **3** Logs / schedule pages | **Eng’d** | `PoolPage` / `DaemonPage` + web `resourcePages`; shell uses `Match.Page` |

### K3. UI Route toolkit (2026-07-29)

HttpApi-shaped `Route` catalog + core `Router` service (`memory` / `history` over `Route.Api`) with `GroupNav` layered over it for Group dashboards. See [`ui-routes-dream.md`](./ui-routes-dream.md). **Navigator → Router cutover Eng’d.**

### L. Acceptance

1. Group opens via kit `Card` + GroupNav — no `Cell` group fork
2. URL path = short member names (`/Nwsl/HttpApi`)  
3. Default family Details body-only; shell owns back/title  
4. `View.compose` runs hyperlink-web + TUI dashboard  
5. WorkerPool example → `View.only` — **done** (`Dashboard views=` / hyperlink-web)  
6. ViewKind stays `card | detail | page`; schedule/logs are **content** that fills sizes  
7. Tests: `Router.memory(site)` (`Group.asRoutes`) + Group card + short-name path + missing skin `R=never`

**Changeset:** minor — `Navigator` removed; Group navigation uses `GroupNav` over `View.compose({ router, group })`.

---

## App shape (batteries Dashboard)

Kit `<Dashboard />` is the public one-liner. Internally it is thin wiring:

`DashboardLayer.forCompose({ skins, views })` → `View.compose` → platform `DashboardShell`.

Public chrome (reuse without forking the shell): `DashboardTopBar`, web `DashboardDetailChrome`, `NodeStatusHost`, plus `NodeBar` / `HealthBoard` / `NodeDetail`.

```tsx
// worker-pool-card.tsx
export const layer = View.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(View.provide(WorkerPoolCard, WorkerPoolCardView)),
)

// app.tsx — public one-liner unchanged
<Dashboard runtime={runtime} group={ServicesHub} views={layer} />
```

Compose + shell (escape hatch; same stack Dashboard uses):

```tsx
const ui = View.compose({
  views: DashboardLayer.forCompose({
    skins: WebDashboardViews.skins,
    views: View.only(WorkerPool, WorkerPoolCard),
  }),
  router: Router.history(
    Route.make("dash").add(
      Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub)),
    ),
  ),
  group: ServicesHub,
})
<ui.Provider>
  <RuntimeProvider runtime={runtime}>
    <DashboardShell group={ServicesHub} />
  </RuntimeProvider>
</ui.Provider>
```

`ui.Grid` uses the optional compose `group`; `ui.Outlet` falls back to route handles when it is absent. Neither is the batteries default (no Cell / NodeBar / HealthBoard / LogBox).

Open Nwsl → HttpApi → browser shows `/Nwsl/HttpApi`.
