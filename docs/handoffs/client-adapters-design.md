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

1. **Family Spec = widget base** — whole Spec (e.g. `queueControlSpec`), not Pick-from-instance. Instance handles are wider; bind if `ServiceOf<Instance> extends ServiceOf<FamilySpec>`.
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

### Layer / DI API sketch (v3 — owner 2026-07-25)

**Split the two styles:**

| Layer | Style | Job |
|-------|--------|-----|
| Registry / bind / Spec / keys | **Effect** — `Context.Service`, `Layer.mergeAll`, type gates | System of record |
| Components / hooks returned to apps | **React** — named components + hooks | DX at the call site |

**Name locked: `View`.** iOS-ish vibe; not “Widget” / `Ui`. Key namespace e.g. `hyperlink/view/pool`.

**No `surface: "card"`.** Defining an entry can attach several React views; **`View.react(layer)` returns multiple components (and tools)**, each already closed over the registry + match rules.

```ts
// ── Effect side: define + register ──────────────────────────────────────────

const Pool = View.make({
  key: "hyperlink/view/pool",
  spec: WorkPool.queueControlSpec, // whole family Spec = Needs
  // named React views — not a surface enum on component()
  card: PoolCard,       // (props: { tag }) => JSX
  detail: PoolDetail,
  // optional later: cell, tools, …
})

const viewLayer = Layer.mergeAll(
  View.base, // shipped entries
  View.register(Pool),
  View.register(WorkerPoolView),
  View.bindFactory(WorkPool.Tag, Pool),     // type-gated
  View.bindTag(SpecialQueue, SpecialView),
)

// ── React side: one call → components + helpers ─────────────────────────────

const {
  Card,       // matcher → entry.card
  Detail,     // matcher → entry.detail
  Provider,   // provides registry Context (from layer)
  useView,    // hook: raw registry / resolve
  resolve,    // (tag) => entry | fallback  (non-hook tool)
} = View.react(viewLayer)

// Call sites — pass the handle/tag only; matching inside
<Provider>
  <Card tag={leaf} name={label} />      {/* grid */}
  <Detail tag={selected} />             {/* drill-in */}
</Provider>
```

**What `View.react` builds (conceptually):**

```ts
function Card(props: { tag: LeafTag; name?: string }) {
  const entry = registry.match(props.tag) // annotation → binds → kind → fallback
  const CardView = entry.card ?? FallbackCard
  return <CardView tag={props.tag} name={props.name} />
}
```

Same match once; **each exported component picks a different view field** on the entry. Missing view on an entry → that component’s fallback (or null) — card-only entries don’t invent a detail.

**Dashboard** becomes:

```tsx
const { Card, Detail, Provider } = View.react(appViewLayer)

<Provider>
  <Grid>{leaves.map((tag) => <Card key={tag.key} tag={tag} />)}</Grid>
  {selected ? <Detail tag={selected} /> : null}
</Provider>
```

Parent still owns routing (what’s selected). No `onOpen` on core Card unless the app wraps it.

**Tools mixed in (optional bag):**

```ts
const views = View.react(viewLayer)
views.Card
views.Detail
views.Provider
views.useView()
views.resolve(tag)
views.keys()           // registered view keys
// later: views.preload(tag), views.has(tag, "detail")
```

Either destructured or `views.*` — React-ergonomic either way; registry stays Effect underneath.

**Naming collision note:** module `View` vs React “view” / local `CardView` variables — fine if the public API is `import * as View from "…/View"` (Effect module style). Avoid `import { View } from "react"` clashes by namespace import.

### Props on `Match` today vs redesign (notes 2026-07-25)

**`name` (today):** not the wire `tag.key`. It’s the **group member label** — the key under which the parent `Group` holds that tag (fallback `displayName(tag.key)` = last path segment). So yes: **display-name override / label from the tree**, not handle identity. Redesign: optional `name?`; default from group context or `displayName(tag.key)`.

**`onOpen` (today):** **not** a generic “opened” listener. Grid **cards** call it on click/activate so the **Dashboard router** can drill in (`route.open(name)`). The card doesn’t own navigation — parent does. Detail views use `onBack` / `onOpenLogs` instead.

Redesign lean: **don’t bake dashboard navigation into the core Match props.** Core = `{ tag }` (+ optional `name`). Navigation/chrome size is a **surface** or parent concern (see card vs detail below).

### Card vs detail (small vs full) — separate?

**Today:** tied only by **convention + Dashboard wiring** — `QueueCard` + `onOpen` → `QueueDetail` switched in `Dashboard.tsx` by `isQueueTag`. Not one widget object with two sizes; two components, one kind switch in the shell.

**Should they be separated?** **Yes.** Same family Spec / view **key**, different **named view fields** on one entry (not a `surface:` arg — see W8):

| View field | Job |
|------------|-----|
| `card` (compact) | Grid cell; may emit “activate” to parent |
| `detail` (full) | Drill-in page; owns denser chrome |
| (later) `cell` / TUI | Ink compact |

```ts
const Pool = View.make({
  key: "hyperlink/view/pool",
  spec: WorkPool.queueControlSpec,
  card: PoolCardView,
  detail: PoolDetailView,
})

const { Card, Detail, Provider } = View.react(viewLayer)
```

Same registry + match rules; each React component picks a different view field on the entry. Parent owns routing (`onActivate` / router), not the registry.

### How Effect handles registries (precedent)

Not a special “Registry” language feature. Pattern:

1. **`Context.Service` for the registry API** — e.g. EventLog’s `Registry` (`Context.Service` with `register*` + lookup maps).
2. **`Layer.effect(Registry, Effect.gen…)`** — allocate `Map`s / state, return `Registry.of({ … })`.
3. **Contribution layers** — `Layer.effectDiscard` / small layers that `yield* Registry` and `register*(…)` at build time (handlers, compactors).
4. **Consumers** — `yield* Registry` then look up by key.

Also: **`Atom.family`** / `AtomRegistry` for reactive memoized entries (different job — atom identity, not plugin table).

**Our lean for views:** same as EventLog — `View` registry Context service + layers that `register(view)` / `bind*(…)`, then `View.react(layer)` builds React that reads that service (from a provided Context / Provider). `Layer.mergeAll(base, user…)` = compose contributions. View Layer is **separate** from `Atom.runtime` (W4).

### Composability / toolkit (parked detail, keep)

- Slots / layout builder on top of Spec base (optional v1 vs thin `View`).
- `fromSpec` / `fromTag` / `fromFactory` helpers.
- Recipes (`withTrend`, log pane) are UI folds — **not** a second service shape in `data.ts`.
- Replace `QueueService` duplicates over time with `ServiceOf<FamilySpec>`.

### LOCKED decisions (2026-07-26)

| # | Decision |
|---|----------|
| W1 | Keys `hyperlink/view/<name>`; uniqueness enforced at `register` |
| W2 | Annotate view key on Tag / `tagFor` options (`view?: string`); Spec-object annotate deferred; Tag stamp Eng is follow-up |
| W3 | Missing match → fallback (no throw at render) |
| W4 | View Layer separate from `Atom.runtime`; `View.react` → Provider |
| W5 | v1 thin card/detail/cell — no slot DSL |
| W6 | Kind match at step 4 only (specialized UX; not primary) |
| W7 | Web + TUI share keys; differ by view fields |
| W8 | Multiple views on one entry; not a `surface:` arg |
| W9 | Core view props `{ tag, name? }` only; activation/nav is parent |
| W10 | Registry = Context.Service + Layer contributions (EventLog-style) |
| W11 | Module name **`View`**; keys `hyperlink/view/…`; prefer `import * as View` |
| W12 | `View.react` returns `{ Card, Detail, Provider, useView, resolve }` (tools bag OK) |

### Eng order (next)

1. Skeleton: `View.make` / `register` / `bind*` / `react`
2. Tag `view?: string` option
3. Migrate queue off `forKind`
4. `Hyperlink.atom` / `query` / `fn` in parallel

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

W1–W12 locked. Eng follows order above — start with `View` skeleton (`make` / `register` / `bind*` / `react`); do **not** wait on Tag stamp or Hyperlink.atom for the registry skeleton. TanStack `useQuery` / Promise adapter still on table for the client-adapter stack.
