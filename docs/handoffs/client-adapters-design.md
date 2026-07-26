# Client adapters — design notes (draft)

**Status:** design capture — not shipped. Owner + Agent G (TUI/dashboard) discussion 2026-07-24 → 2026-07-25.  
**Related tip work:** TUI ↔ web Group dashboard parity (`cursor/tui-dashboard-parity-125f`); widget registry in `hyperlink-ts/ui`.

Capture so nothing from the conversation is lost. Decisions below are **direction**, not Eng’d APIs.

---

## Problem

1. **Dashboard custom cards** need a clean way to bind HyperService handle fields to UI without hand-rolling `runtime.atom` / `Stream.tick`.
2. **Consumers outside Effect** should still use a HyperService if they agree on the wire contract — Promise/async, TanStack Query, etc.
3. **One contract, two first-class React query styles** — Hyperlink-shaped hooks backed by **TanStack**, and a separate Effect-reactive-native helper family. Plus Promise/async for non-React / non-Effect.

---

## Hard rules (owner)

- **No polling** for live dashboard data. Live fields are push (`ref` / `subscribable` / `stream`). One-shot `effect` fields are queries/commands, not tick loops.
- Today’s `Stream.tick` usage in fleet bundles / `WorkerPoolCard` / daemon schedule is the **anti-pattern** relative to this rule — fix by making watched fields reactive on the contract, or query+invalidate, not timers.
- Widget **registry** today (`forKind` / `forKey` / `withEntries` onto `base`) is the current plug-in seam; **redesign in flight** (see [View system redesign](#widget-system-redesign-2026-07-25)) — keyed `View`s, Spec/family base, Layer-native registration, no accidental structural match.
- `GroupNode` name kept (docs clarify: group-tree node ≠ transport `Node`).
- Gate observe surface (`Pick<Gate.Handle, "status">`) was a small SSOT pilot; full handle-projected observe types parked until owner cares.

---

## Adapter stack (corrected 2026-07-24)

```
Contract (Hyperlink Spec / handle)
        │
        ├─► Promise / async client          (“works anywhere”)
        │
        ├─► Hyperlink.useQuery / useMutation   ← OUR API, implemented WITH TanStack under the hood
        │         (optional: also export queryOptions for people who wire TanStack themselves — keep on table)
        │         └─► tRPC-shaped facade       (looks like tRPC; no tRPC dep; can sit on TanStack-backed hooks)
        │
        └─► Effect-reactive-native helpers     ← separate family; feels like effect/unstable/reactivity
                  (atoms / AsyncResult / subscribe / fn — NOT a TanStack clone)
                  └─► dashboard bundles / cards (main path for our dashboard)
```

### Clarification (owner)

- **`Hyperlink.useQuery(WorkerPool, (p) => p.active)`** is a **Hyperlink** hook. Callers don’t assemble TanStack. **Under the hood** it is built with `@tanstack/react-query` (real TanStack — cache, invalidate, etc.).
- **Keep on the table:** also expose `queryOptions` / raw TanStack wiring for apps that already own a QueryClient and want to pass Hyperlink into TanStack themselves.
- **Alternative helper family:** built on **Effect reactive** (`effect/unstable/reactivity`), designed to **feel native to Effect reactive** (Atom, `AsyncResult`, subscribe, `fn`, `Reactivity` keys) — not “TanStack names on atoms.”
- Dashboard default = Effect-reactive family. TanStack-backed `Hyperlink.useQuery` = for TanStack/React ecosystems.

### 1. Promise / async handle adapter — “game changer”

- Take a HyperService **client handle** (or tag + transport already connected) and expose every method as **Promise/async**.
- Goal: use the service **completely outside** an Effect runtime (scripts, Next handlers, non-Effect apps).
- Theoretically: generate clients for **any** runtime as long as the **contract is agreed** (same schemas / RPC).
- Likely feeds the TanStack-backed hooks’ `queryFn` (Promise boundary).
- Open design: how much of serve/client stack is required vs pure wire codecs; error channel → rejected Promise vs Result type; streaming methods → async iterables?

### 2. TanStack-backed Hyperlink hooks

- **Surface:** `Hyperlink.useQuery(tag, select)`, `Hyperlink.useMutation(tag, select)` (names/namespace TBD — may live under a React subpath, not necessarily the `Hyperlink` barrel).
- **Implementation:** `@tanstack/react-query` peer — Hyperlink owns the hook; TanStack owns the cache.
- **Not** “here are options, you call `useQuery` from TanStack” as the primary DX (that export can exist as an advanced escape hatch).
- Invalidation keys from Spec identity (tag key + method) where possible.
- Live push fields: either out of scope for this lane, or a separate subscribe path — don’t fake live with `refetchInterval`.

### 3. tRPC-shaped facade — shape only

- Ergonomics like `api.WorkerPool.active.useQuery()` without shipping tRPC.
- Prefer sitting on the **TanStack-backed** Hyperlink hooks; Spec-generated procedure tree.
- No `@trpc/*` dependency.

### 4. Effect-reactive-native helpers — public family (not dashboard-only)

Uses official **`effect/unstable/reactivity`** (not standalone `@effect-atom`). API should feel like Effect reactivity.

`Atom.runtime(layer)` builds an `AtomRuntime`: an atom of `AsyncResult<Context<R>>` plus `.atom` / `.fn` / `.pull` / `.subscriptionRef` that run only once that context is `Success`. Not a Node runtime; not a dashboard type. (`DashboardRuntime` in `ui/data.ts` is just an alias for `Atom.AtomRuntime` — avoid that name on the public helper surface.)

#### Locked (2026-07-25)

| # | Decision |
|---|----------|
| Name / home | **`Hyperlink.atom`** on the public surface (tree-shaking keeps unused adapters out if exports are correct). |
| Select shape | **Both** for Subscribables: `(q) => q.status` *or* `(q) => q.status.changes`. Non-Subscribable live sources must be selected directly, e.g. `(q) => q.metrics.stream` — not `(q) => q.metrics`. |
| Runtime plumbing | **All three:** (A) explicit `Atom.AtomRuntime` as the core API; (B) handle / stream overloads when the caller already has a source; (C) React convenience helpers that read runtime from context — never the only API. |
| Return type | **R1:** `Atom<AsyncResult<A, E>>` — same as Effect’s `runtime.atom(Stream)`. Preserve `E` (do not default to `unknown`). Bundle `ValueAtom<A> = AsyncResult<A, unknown>` erasure stays a dashboard/widget detail, not the public helper contract. No `Option` wrap on plain live fields. |
| Cache / identity | **`Atom.family`** with a canonical channel key (Effect-native, same pattern as `AtomRpc`). Lambdas OK via path extraction so `status` and `status.changes` share one atom. |
| Live vs siblings | **L1 (confirmed):** `Hyperlink.atom` = live Subscribable/Stream only — not Effects. |
| Commands | **`Hyperlink.fn`** — wraps `runtime.fn`; Effect-primitive name. |
| One-shot read | **`Hyperlink.query`** — `runtime.atom(Effect)`; refresh / `withReactivity`. AtomRpc precedent; distinct from TanStack `Hyperlink.useQuery`. |

#### Proposed call shapes (direction)

```ts
const rt = Atom.runtime(appLayer)

// Live push
const statusAtom = Hyperlink.atom(rt)(MyQueue, (q) => q.status)
const metricsAtom = Hyperlink.atom(rt)(MyQueue, (q) => q.metrics.stream)

// Command
const pause = Hyperlink.fn(rt)(MyQueue, (q) => q.pause)

// One-shot read (L1 sibling — not atom)
const seed = Hyperlink.query(rt)(MyQueue, (q) => q.metrics.query({ limit: 50 }))

// B — already-resolved source
Hyperlink.atom(handle.status)
Hyperlink.atom(handle.metrics.stream)

// C — React convenience (provider holds Atom.AtomRuntime + registry)
const statusAtom = Hyperlink.useServiceAtom(MyQueue, (q) => q.status)
```

| Handle field | Direction | Behavior |
|--------------|-----------|----------|
| `ref` / `subscribable` / `stream` | `Hyperlink.atom` | Push → `Atom<AsyncResult<A, E>>` |
| `effect` (read) | `Hyperlink.query` | `runtime.atom(Effect)`; refresh / `withReactivity` |
| `effect` (command) | `Hyperlink.fn` | `runtime.fn` — same as today’s pause/resume |

**Do not** name/shape this family as a TanStack clone. Native = `Atom`, `AsyncResult`, mount/subscribe, `fn`, optional `withReactivity` / `swr`.  
(`query` here is the AtomRpc-shaped Effect-reactive helper — not TanStack; TanStack lane is `Hyperlink.useQuery`.)

#### Effect-reactive surface (locked)

```ts
Hyperlink.atom   // live push (Subscribable | Stream)
Hyperlink.query  // one-shot Effect read
Hyperlink.fn     // command
// + form B (handle/stream) and form C (React convenience) on atom / as needed
```

#### Still to lock (adapters)

- Shared Spec walker with Promise adapter vs separate.
- TanStack `useQuery` / `queryOptions` escape hatch v1.

---

## View system redesign (2026-07-25)

**Status:** design capture — W1–W12 **locked** 2026-07-26; not Eng’d. Continues owner + Agent G discussion after Effect-reactive helpers lock. Anchor `#widget-system-redesign-2026-07-25` kept for existing links.

### Pain (why redesign)

- Widget service shape is **hand-copied** in `src/ui/data.ts` (`QueueService`, …) + hardcoded in bundles — not Spec.
- Match is **nominal kind/key** only; no type-level “handle compatible with widget.”
- Cards/bundles are monolithic; custom services re-hand-roll atoms.
- Structural “sniff fields → pick widget” would cause **accidental matches** — rejected as default dispatch.

### Direction (aligned)

1. **Family Spec = view Needs base** — whole Spec (e.g. `queueControlSpec`), not Pick-from-instance. Instance handles are wider; bind if `ServiceOf<Instance> extends ServiceOf<FamilySpec>`.
2. **Specs are combinable** today via object spread / `&` / `tagFor(sharedSpec)` — no separate Spec algebra required. `queueSpec` = `{ ...queueControlSpec, add, … }`.
3. **Views are keyed** — same culture as services/tags; uniqueness at `register` (W1). Keys: `hyperlink/view/<name>`.
4. **Annotate tag with view key** — Tag / `tagFor` options `view?: string` (W2). Spec-object annotate deferred; Tag stamp Eng follow-up. Overridable on instance tag.
5. **No accidental structural match** — structural/`ServiceOf` assignability is a **compile-time bind gate**, not a runtime search over the registry.
6. **Binding helpers** (locked above): thin views use `Hyperlink.atom` / `query` / `fn` (no slot DSL in v1 — W5).
7. **Registration feels Effect-native** — View Layer / Context DI builds the matcher; `View.react` → Provider (separate from `Atom.runtime` — W4).

### Specs: extend / combine (notes)

| Pattern | Example |
|---------|---------|
| Spread extend | `queueSpec` → `{ ...queueControlSpec, add, prioritize, … }` |
| Shared family | `Hyperlink.tagFor(groupId, sharedSpec)` — one Spec, many instance keys |
| Type intersect | `BaseSpec & { schedule: … }` (daemon grafts) |
| Store merge | `mergeSpecs` (`Object.assign`) — precedent for combining records |

`View.make({ spec: familyControlSpec, … })` uses the **family** Spec as Needs SSOT.

### Keys & annotation (notes)

```
ViewKey     ≈ stable string id   e.g. "hyperlink/view/pool"
Service key = tag.key            instance identity (already)
View key    ≠ service key        different namespaces; don’t collide with tag keys
```

**Annotation on Tag / `tagFor` options** (locked W2 — Spec-object annotate deferred):

```ts
Hyperlink.tagFor("queue", queueControlSpec, { view: "hyperlink/view/pool" })
WorkPool.Tag(…) // factory may carry view key; Tag stamp Eng is follow-up
```

**Instance override** when a specific service needs different chrome:

```ts
class SpecialQueue extends WorkPool.Tag<SpecialQueue>()("app/Special", …)
// stamp / annotate view key → "app/view/special-queue"
```

**Dispatch when annotation present:** use view key; missing match → **fallback** (no throw at render — W3).  
**When absent:** explicit registry binding (factory→view / useSpec) or kind for specialized UX — never field-sniff.

### Match order (no accidents)

```
1. resource/tag view annotation (if set)
2. exact resource key → view override (forKey-style)
3. explicit family / Spec / factory → view binding (registered)
4. kind → view (specialized UX only — W6; not primary match)
5. fallback
```

**Not in the list:** “first view whose Needs ⊆ tag Spec.”

Type-level: `Compatible` / `BindTag` so `registry.use(Factory, View)` or `View.bind(Tag)` fails compile if handle isn’t assignable to family Spec.

### Layer / DI API sketch (v4 — owner 2026-07-26)

**Split the two styles:**

| Layer | Style | Job |
|-------|--------|-----|
| Registry / bind / Spec / keys | **Effect** — `Context.Service`, `Layer.mergeAll`, type gates | System of record |
| Components / hooks returned to apps | **React** — named components + hooks | DX at the call site |

**Name locked: `View`.** Key namespace e.g. `hyperlink/view/pool-card`.

#### Three view kinds (roles) — Card / Detail / Page

Owner (2026-07-26): not just card vs “page.” **Three kinds** (names bakeable; intent locked):

| Kind | Intent | Typical host |
|------|--------|----------------|
| **Card** | Compact chrome (grid / dashboard tile) | Mobile + desktop grids |
| **Detail** | Mid-size drill-in (today’s “detail” screens) | Stack / modal / split |
| **Page** | Full desktop (or full-bleed) chrome | Desktop shell — **not v1 priority** |

- **Do not** hard-tie kinds together on one registry entry (no “this card owns that detail”).
- Each registered entry = **one kind + one React component** (+ key + family Spec).
- **Match is independent per kind.** Custom card does not drop default Detail/Page; etc.
- TUI: prefer **same Card/Detail handles** with Ink components in a TUI Layer (W7/W13). Optional **`cell`** kind later only if Ink needs a distinct role.

#### Multi-match presentation (document now, don’t design chrome yet)

- For a given tag + kind, match can return **several** entries (ordered list).
- **Mobile / small:** paginate (swipe / pager).
- **Desktop:** prefer a **tabbed** interface over pagination for the same multi-match list — **keep in mind; do not design tabs now.**
- Example: register a custom Card → shows first; default family Card still matches → second slot in the card pager/tabs. Detail/Page lists unchanged unless those kinds are also registered/bound.
- **Only one Card:** `.pipe(View.card(key))` allowlist on the handle (same for `View.detail` / `View.page` when needed).

#### Nesting (composition)

- Larger views **may nest** smaller ones: e.g. a Page composed of a Detail plus several Cards (or matched Card/Detail lists).
- Nesting is normal React composition + calling `View.Card` / `View.Detail` (or resolve) inside a Page component — not a separate registry feature.
- **Desktop Page kind is not priority**; nest patterns can land when Page is real. Don’t block Card/Detail Eng on Page.

#### Explicit pin / restrict — pipe on the handle

Not a Tag options `.view` field (parked). Owner: **pipe onto the handle/tag**:

```ts
class MyQueue extends WorkPool.Tag<MyQueue>()("app/MyQueue", { payload }).pipe(
  View.card("hyperlink/view/my-custom-card"), // only this card for this tag
)

// detail / page similarly when needed
.someTag.pipe(View.detail("hyperlink/view/my-detail"))
```

- `View.card|detail|page(key)` = allowlist for that kind on that tag when present.
- Lean: **allowlist when pipe present**, else full multi-match list. Exact pipe semantics bake at Eng.

#### Same View handle, different TSX Layer (web ↔ TUI) — LOCKED

Owner (2026-07-26): **identity and matching are shared; the React/Ink component is Layer DI.**

| Piece | Lives where | Shared? |
|-------|-------------|---------|
| View **handle** (key + kind + Spec / Needs) | `View.make` / `View.Tag` — no TSX | Yes — web + TUI + binds/pipe |
| Match / bind / pipe allowlist | Effect registry Layer | Yes |
| **TSX** (DOM React vs Ink / TUI) | `View.register(handle, Component)` in a **platform Layer** | No — swap Layer |

```ts
// Shared identity — no component baked in
const PoolCard = View.make({
  key: "hyperlink/view/pool-card",
  kind: "card",
  spec: WorkPool.queueControlSpec,
})
const PoolDetail = View.make({
  key: "hyperlink/view/pool-detail",
  kind: "detail",
  spec: WorkPool.queueControlSpec,
})

// Same binds on both platforms
const poolBinds = Layer.mergeAll(
  View.bindFactory(WorkPool.Tag, PoolCard),
  View.bindFactory(WorkPool.Tag, PoolDetail),
)

// Web chrome
const webViews = Layer.mergeAll(
  View.register(PoolCard, WebPoolCard),
  View.register(PoolDetail, WebPoolDetail),
  poolBinds,
).pipe(Layer.provideMerge(View.base))

// TUI chrome — same handles, Ink components
const tuiViews = Layer.mergeAll(
  View.register(PoolCard, TuiPoolCard),
  View.register(PoolDetail, TuiPoolDetail),
  poolBinds,
).pipe(Layer.provideMerge(View.base))

const { Card, Detail, Provider } = View.react(webViews) // or tuiViews
```

- **Do not** put React components on service Tags or on the shared handle definition.
- Optional `View.Tag` (identity-only Context/Tag shape) is fine if it stays free of TSX; Eng may keep `View.make` as the handle factory.
- TUI does **not** need a separate `cell` kind for v1 if Card/Detail Ink skins are enough — `cell` remains optional later (W7).
- Precedent vibe: headless identity + skin Layer (MUI slots / theme overrides / Context), but **Effect `Layer` is the DI**, not a React-only theme object.

#### Mechanics (proposed — grilling 2026-07-26)

End-to-end at runtime (one platform process):

```
View.make → Handle (key, kind, spec)          // module load, no Layer
View.bind* / View.register(handle, Comp)     // contribution Layers
View.react(platformLayer)                    // Layer.build once → Registry snapshot
  └─ Provider value = RegistryService
<Card tag={leaf} />                          // match(tag, "card") → Resolved[]
  └─ pager/tabs host renders Resolved[i].Component({ tag, name? })
```

**1. Handle (identity only)**

```ts
type ViewKind = "card" | "detail" | "page"
type Handle = {
  readonly key: ViewKey           // "hyperlink/view/pool-card"
  readonly kind: ViewKind
  readonly spec: unknown          // family Spec / Needs SSOT (typed later)
}
```

- `View.make({ key, kind, spec })` returns a Handle. **No Component field.**
- Pipe targets and binds refer to Handles (or their keys).
- Same Handle module can be imported by web and TUI packages.

**2. Registry tables (built by Layers)**

| Table | Key | Value | Written by |
|-------|-----|-------|------------|
| `skins` | `ViewKey` | `{ handle, Component }` | `View.register(handle, Comp)` |
| `byTagKey` | `tag.key` | `ViewKey[]` (ordered) | `View.bindTag` |
| `byFactory` | `groupId` | `ViewKey[]` | `View.bindFactory` |
| `byKind` | hyperlink kind | `ViewKey[]` | `View.bindKind` |

- **Duplicate `register` same key** in one Layer build → `DuplicateViewKey` (fail build).
- Web vs TUI never share a Registry instance — each `View.react(layer)` builds its own snapshot.
- Binds may list a key that has no skin → that candidate is **dropped at match** (skip missing skins). Do **not** fail `Layer.build`. Fallback only if the resolved list is empty after filtering (W3).

**3. `match(tag, kind) → ReadonlyArray<Resolved>`**

```ts
type Resolved = {
  readonly handle: Handle
  readonly Component: ViewComponent
}
```

Collect candidates **for that kind only**, in order, then filter by pipe allowlist if present:

```
candidates = []
// A. exact tag.key binds whose handle.kind === kind
// B. factory groupId binds (tag.groupId) whose handle.kind === kind
// C. intentional kind binds (kindOf(tag)) whose handle.kind === kind
// D. (optional) fallback handle for that kind — never empty render
dedupe by ViewKey, preserve first-seen order
if tag has pipe allowlist for this kind → intersect / replace with allowlisted keys
map ViewKey → skins.get → skip missing skins → Resolved[]
```

**Note:** Tag `.view` annotation is **parked** (W2 = pipe). Do not use annotation as match step 1 in Eng.

**4. Pipe allowlist (identity on the service handle)**

```ts
someTag.pipe(View.card("hyperlink/view/my-custom-card"))
```

- Stores allowlist metadata on the **service tag** (not the View handle): e.g. `views?: { card?: ViewKey[], detail?: … }`.
- When present for a kind: match returns **only** those keys (that still have skins), in pipe order — not the full multi-match list.
- When absent: full multi-match list from binds.

**5. React kit**

```ts
View.react(layer) → {
  Provider,          // React context = Registry snapshot
  Card, Detail, Page,// match(tag, kind) + host (pager stub OK)
  useView, resolve,  // resolve(tag, kind) → Resolved[]
  registry,
}
```

- `Card` / `Detail` are **matchers + hosts**, not the leaf chrome.
- Leaf chrome = `Resolved.Component`.
- Navigation (`onOpen` / route) stays outside core `ViewProps` (W9).

**6. Platform split packaging (lean)**

| Package / folder | Owns |
|------------------|------|
| Shared (`hyperlink-ts/ui` or `ui/views/*`) | Handles + bind Layers (`poolBinds`) |
| Web app / `ui/web` | `View.register(handle, WebComp)` Layers + DOM components |
| TUI app / `ui/tui` | `View.register(handle, TuiComp)` Layers + Ink components |

`View.react(webLayer)` vs `View.react(tuiLayer)` is the only platform fork at the Dashboard edge.

**Locked (grilling):** missing skin → skip at match (W14).

**Open (grilling):** handle brand (`make` vs `View.Tag`); multi-match host chrome; pipe storage shape; compile-time Spec gate timing; candidate order across bind tiers.

#### Define + register (one entry = one kind)

```ts
const PoolCard = View.make({
  key: "hyperlink/view/pool-card",
  spec: WorkPool.queueControlSpec,
  kind: "card",
})
const PoolDetail = View.make({
  key: "hyperlink/view/pool-detail",
  spec: WorkPool.queueControlSpec,
  kind: "detail",
})
// Page — when we care about full desktop; not v1 priority
const PoolPage = View.make({
  key: "hyperlink/view/pool-page",
  spec: WorkPool.queueControlSpec,
  kind: "page",
})

const viewLayer = Layer.mergeAll(
  View.register(PoolCard, PoolCardView),
  View.register(PoolDetail, PoolDetailView),
  View.bindFactory(WorkPool.Tag, PoolCard),
  View.bindFactory(WorkPool.Tag, PoolDetail),
  View.register(CustomCard, CustomCardView),
  View.bindFactory(WorkPool.Tag, CustomCard), // custom card first; PoolCard still second unless piped
).pipe(Layer.provideMerge(View.base))
```

#### React kit

```ts
const { Card, Detail, Page, Provider, useView, resolve } = View.react(viewLayer)
// View.Card shortcut for the Card matcher is fine

<Provider>
  <Card tag={leaf} name={label} />     {/* multi-match → pager (mobile) / tabs later (desktop) */}
  <Detail tag={selected} />
  {/* <Page tag={selected} /> — desktop full chrome; not priority */}
</Provider>
```

**Match inputs (no `.view` annotation):** tag-key bind → factory bind → kind bind → fallback. Multi-match = all entries for that **view kind**, ordered (TBD).

**Skeleton note:** `src/ui/View.tsx` is pre-v4 (card/detail fields on one entry; component on `make`). Reshape to **kind + multi-match + register(handle, Component)**; Page can stub/no-op until prioritized.

### Props on `Match` today vs redesign (notes 2026-07-25)

**`name` (today):** not the wire `tag.key`. It’s the **group member label** — the key under which the parent `Group` holds that tag (fallback `displayName(tag.key)` = last path segment). So yes: **display-name override / label from the tree**, not handle identity. Redesign: optional `name?`; default from group context or `displayName(tag.key)`.

**`onOpen` (today):** **not** a generic “opened” listener. Grid **cards** call it on click/activate so the **Dashboard router** can drill in (`route.open(name)`). The card doesn’t own navigation — parent does. Detail views use `onBack` / `onOpenLogs` instead.

Redesign lean: **don’t bake dashboard navigation into the core Match props.** Core = `{ tag }` (+ optional `name`). Navigation is a parent/shell concern.

### Card vs detail vs page — separate kinds (supersedes one-entry multi-field)

**Today:** tied by **convention + Dashboard wiring** — `QueueCard` + `onOpen` → `QueueDetail` in `Dashboard.tsx`. Two components, one kind switch in the shell.

**Locked (W8):** separate registry entries per kind (`card` / `detail` / `page`), not `card`+`detail` fields on one `make`. Parent owns routing; web vs TUI swaps TSX via Layer (above).

### How Effect handles registries (precedent)

Not a special “Registry” language feature. Pattern:

1. **`Context.Service` for the registry API** — e.g. EventLog’s `Registry` (`Context.Service` with `register*` + lookup maps).
2. **`Layer.effect(Registry, Effect.gen…)`** — allocate `Map`s / state, return `Registry.of({ … })`.
3. **Contribution layers** — `Layer.effectDiscard` / small layers that `yield* Registry` and `register*(…)` at build time (handlers, compactors).
4. **Consumers** — `yield* Registry` then look up by key.

Also: **`Atom.family`** / `AtomRegistry` for reactive memoized entries (different job — atom identity, not plugin table).

**Our lean for views:** same as EventLog — `View` registry Context service + layers that `register(view)` / `bind*(…)`, then `View.react(layer)` builds React that reads that service (from a provided Context / Provider). `Layer.mergeAll(base, user…)` = compose contributions. View Layer is **separate** from `Atom.runtime` (W4).

### Composability / toolkit (parked detail, keep)

- Slots / layout builder on top of Spec base (parked — not v1; W5).
- `fromSpec` / `fromTag` / `fromFactory` helpers.
- Recipes (`withTrend`, log pane) are UI folds — **not** a second service shape in `data.ts`.
- Replace `QueueService` duplicates over time with `ServiceOf<FamilySpec>`.

### LOCKED decisions (2026-07-26)

| # | Decision |
|---|----------|
| W1 | Keys `hyperlink/view/<name>`; uniqueness enforced at `register` |
| W2 | Explicit pin/restrict via **`.pipe(View.card(key))` / `View.page(key)` on the handle** — not Tag `.view` field (parked) |
| W3 | Missing match → fallback (no throw at render) |
| W4 | View Layer separate from `Atom.runtime`; `View.react` → Provider |
| W5 | v1 thin components — no slot DSL |
| W6 | Kind match only as an intentional bind step |
| W7 | **Same View handle (key+kind+Spec), different TSX Layer** for web vs TUI; matching/binds shared; optional `cell` kind later if Ink needs it |
| W8 | **Kinds: `card` \| `detail` \| `page`** (independent entries); **multi-match** → pager (mobile) / **tabs on desktop (later, don’t design now)**; nesting OK (Page may compose Detail + Cards) |
| W9 | Core props `{ tag, name? }`; activation/nav is parent |
| W10 | Registry = Context.Service + Layer contributions (EventLog-style) |
| W11 | Module name **`View`**; keys `hyperlink/view/…` |
| W12 | `View.react` → `{ Card, Detail, Page, Provider, useView, resolve }` (`View.Card` shortcut OK); **Page not v1 priority** |
| W13 | **No TSX on shared handle / service Tag** — `View.register(handle, Component)` is the skin seam |
| W14 | Missing skin for a bound key → **skip at match**; never fail Layer build; fallback only if list empty |

### Eng order (next)

1. Reshape skeleton to **kind + multi-match** + **`register(handle, Component)`** (`card` / `detail`; Page stub OK)
2. Handle **pipe** `View.card` / `View.detail` (/ `View.page`) allowlist
3. Split web vs TUI contribution Layers over the same handles (even if TUI skins land after web)
4. Migrate queue defaults as separate Card + Detail entries
5. `Hyperlink.atom` / `query` / `fn` in parallel
6. Desktop tabs + real Page kind — later

### Non-goals (view redesign)

- Runtime structural auto-match by field paths.
- View key namespace colliding with service `tag.key`.
- Keeping `ui/data.ts` `*Service` as SSOT once Spec-based views land.
- Slot DSL in v1 (W5).

---

## Dashboard context (already shipped / in flight)

- Shared `hyperlink-ts/ui`: data bundles, `groupRoute`, `memberKind` / `wireKindOf`, widget registry (`forKind` / `forKey` — migrate off).
- Web + TUI: `<Dashboard runtime group path? widgets? />`; default `base` registry.
- Custom example: `examples/resource-web` — `withEntries(base, [forKey(WorkerPool.key, WorkerPoolCard)])`.
- TUI kind cells for gate/api/fleetHealth/telemetry/shardMap; unknown leaves show kind + node.
- **Superseded over time** by keyed Spec/Layer `View` system above.

---

## Non-goals (for now)

- Polling helpers as the live-data API.
- Selling `widgets={withEntries…}` as the primary Dashboard DX.
- Full observe-surface `Pick` across every handle type (parked).
- Actually depending on tRPC.
- Accidental structural view matching.

---

## Next conversation

v4: kinds Card / Detail / Page; multi-match; **shared View handle + platform TSX Layers (web/TUI)**; handle pipe. Page + tabs not priority. Reshape skeleton (`register(handle, Component)`); bake match ordering + pipe. TanStack / Promise adapter still on table.
