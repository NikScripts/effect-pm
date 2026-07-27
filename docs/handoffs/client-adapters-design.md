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
| Shared family | `Hyperlink.tagFor` / contract factory — many instance keys, one Spec; **identity for UI is `kind` + `key`, not RPC `groupId`** |
| Type intersect | `BaseSpec & { schedule: … }` (daemon grafts) |
| Store merge | `mergeSpecs` (`Object.assign`) — precedent for combining records |

`View.make({ spec: familyControlSpec, … })` uses the **family** Spec as Needs SSOT.

### Keys & annotation (notes)

```
ViewKey     ≈ stable string id   e.g. "hyperlink/view/pool"
Service key = tag.key            instance identity (already)
View key    ≠ service key        different namespaces; don’t collide with tag keys
```

**Pin / restrict** (W2 — pipe on handle; Tag `.view` parked):

```ts
class SpecialQueue extends WorkPool.Tag<SpecialQueue>()("app/Special", …)
SpecialQueue.pipe(Hyperlink.components([SpecialCard]))
```

**Dispatch:** tag.key binds → stamped `kindOf(tag)` binds → fallback (W3). Never RPC `groupId`. Never short `"queue"` / `"pool"`.

### Match order (no accidents)

```
1. exact resource key → view override (bindTag / forKey-style)
2. stamped contract kind (kindOf(tag) === WorkPool.kind, …) → view (bindKind)
3. fallback
```

**Not in the list:** RPC `groupId`; short costume kinds (`"queue"` / `"pool"`); “first view whose Needs ⊆ tag Spec”; Tag `.view` annotation (parked).

Type-level: `Compatible` / `BindTag` so `View.bindKind` / Spec gates fail compile if handle isn’t assignable to family Spec.

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
- **Pin chrome:** `.pipe(Hyperlink.components([CustomCard]))` (array; partition by kind).

#### Nesting (composition)

- Larger views **may nest** smaller ones: e.g. a Page composed of a Detail plus several Cards (or matched Card/Detail lists).
- Nesting is normal React composition + calling `View.Card` / `View.Detail` (or resolve) inside a Page component — not a separate registry feature.
- **Desktop Page kind is not priority**; nest patterns can land when Page is real. Don’t block Card/Detail Eng on Page.

#### Explicit pin / restrict — pipe on the handle

Not a Tag options `.view` field (parked). Owner: **pipe onto the handle/tag**:

```ts
class MyQueue extends WorkPool.Tag<MyQueue>()("app/MyQueue", { payload }).pipe(
  Hyperlink.components([CustomCard, CustomDetail]), // kinds present replace binds
)
```

#### Same View handle, different TSX Layer (web ↔ TUI) — LOCKED

Owner (2026-07-26): **identity and matching are shared; the React/Ink component is Layer DI.**

| Piece | Lives where | Shared? |
|-------|-------------|---------|
| View **service** (key + kind + Spec) | `View.Tag` / `View.make` — Context service whose **Svc = Component** | Yes — identity + binds/pipe |
| Match / bind / `Hyperlink.components` | Registry + HS pin (Effect) | Yes |
| **TSX implementation** | **`Layer.succeed(PoolCard, Comp)`** (or equiv) — provide the service | No — swap provide Layer |

**Correct model (owner correction 2026-07-26):** Views are **registered as services**. The TSX is not a second argument on a skins map — it is the **service implementation**, provided like any Effect dependency. Same View service tag; web vs TUI = different `Layer` that `succeed`s a different Component.

```ts
// Shared — View services (no TSX baked into the tag definition)
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

const poolBinds = Layer.mergeAll(
  View.bindKind(WorkPool.kind, PoolCard),
  View.bindKind(WorkPool.kind, PoolDetail),
)

// This process provides implementations (DOM *or* Ink — one provide Layer)
const chrome = Layer.mergeAll(
  Layer.succeed(PoolCard, PoolCardView),
  Layer.succeed(PoolDetail, PoolDetailView),
  Layer.succeed(CustomCard, CustomCardView),
)

const { Card, Detail, Provider } = View.react(
  Layer.mergeAll(poolBinds, chrome).pipe(Layer.provideMerge(View.base)),
)
```

- **Do not** invent `View.skins.register(Handle, Comp)` as a parallel DI — that was the mistake; Effect `Layer` **is** the skin seam.
- TUI app: same `PoolCard` / `PoolDetail` services, different `Layer.succeed(…, InkComp)`.
- Optional `cell` kind later only if Ink needs a distinct role (W7).

#### Mechanics (proposed — grilling 2026-07-26)

End-to-end at runtime (one process):

```
View.make / View.Tag → View service (key, kind, spec; Svc = Component)
View.bind* + Layer.succeed(ViewSvc, Comp)    // binds + provide implementations
View.react(viewLayer)                        // run Layer (R must be never) → kit
  └─ resolve Component from Context for matched View services
<Card tag={leaf} />                          // match → Resolved[]; render provided Comp
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
| `byTagKey` | `tag.key` | `AnyView[]` (ordered) | `View.bindTag` |
| `byKind` | stamped contract kind (`WorkPool.kind`, …) | `AnyView[]` | `View.bindKind` |

- **View service** from `View.make` = `Context.Service` whose Svc is `ViewComponent`, plus `key` / `kind` / `spec`.
- **Provide TSX** with `Layer.succeed(PoolCard, Comp)` (or `effect` / `sync`).
- **Binds require** those View services (`yield*` at bind build) so they appear in Layer `R` until provided.
- **No `groupId` in View.** Match: `tag.key` → `kindOf(tag)` → fallback; pins via `Hyperlink.components([…])` replace per kind.
- **`View.react(layer)`** requires `R = never` (runs the Layer). Missing provide ⇒ type error.
- Runtime W14 skip = last resort only (unpiped/dynamic), not for declared binds.

**3. `match(tag, viewKind) → ReadonlyArray<Resolved>`**

```ts
type Resolved = {
  readonly handle: Handle
  readonly Component: ViewComponent
}
```

Collect candidates **for that view kind** (`card`/`detail`/`page`) only, in order, then filter by pipe allowlist if present:

```
candidates = []
// A. exact tag.key binds whose handle.kind === viewKind
// B. stamped kindOf(tag) binds whose handle.kind === viewKind
// C. (optional) fallback handle for that viewKind — never empty render
dedupe by ViewKey, preserve first-seen order
if tag has pipe allowlist for this viewKind → intersect / replace with allowlisted keys
map ViewKey → skins.get → skip missing skins → Resolved[]
```

**Note:** Tag `.view` annotation is **parked** (W2 = pipe). Do not use annotation as match step 1 in Eng. Never key View dispatch on RPC `groupId` or short strings `"queue"` / `"pool"`.

**4. Pipe allowlist** — see **Pipe API — `Hyperlink.components(Handle[])`** (W16/W19). Single array; partition by `kind`; replace binds per kind present; second pipe replaces whole list.

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
| Shared | View services (`View.make`) + bind Layers |
| App (web or TUI) | `Layer.succeed(View, Comp)` for that process + `View.react(fullyProvidedLayer)` |

One provide Layer per process — not web+TUI in the same merge.

**Locked (grilling):** W14–W19; View services + Layer-provided TSX (not skins.register map); components = single array; missing skin = not provided.

**Locked (grilling):** W20 `View.group` + lean `kit.for(tag)`. **Open:** Dashboard on kit; Spec gate; default chrome module layout (fat namespace OK if no platform TSX in shared).

#### View handles on HS tags (W17) — LOCKED (clarified)

Owner (2026-07-26): HS handles **only** carry View handles/keys when you want to **replace** the automatically assigned components (customization / lock-down). **That is not the default.**

| Mode | What’s on the HS handle | How chrome is chosen |
|------|-------------------------|----------------------|
| **Default (common)** | **No** View handles | Registry binds (`bindTag` / `bindKind`) + skins — automatic |
| **Custom (opt-in)** | Pipe `Hyperlink.components([…Handles])` | For each `handle.kind` present in the array, that kind’s allowlist **replaces** binds |

```ts
// Default — nothing on the handle; Card matches via binds
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload }) {}
<Card tag={Jobs} />

// Custom — one array; partition by handle.kind; type-check skins in View.react kit
class Special extends WorkPool.Tag<Special>()("app/Special", { payload }).pipe(
  Hyperlink.components([CustomCard, PoolCard, CustomDetail]),
)
```

**When it carries none:** no View-brand requirement on `<Card tag />` — normal LeafTag + registry match.

**Group later:** same rule — members usually unpiped; piped members get the narrow checks; Group APIs can require member pins only where customization was declared.

#### Type gates when piped — priority (owner 2026-07-26)

| Priority | Gate | Status |
|----------|------|--------|
| **#1** | **Missing skin** — every View **service** pinned on the HS tag must be **provided** in the Layer `View.react` builds (same as any missing Effect dependency) | **Required** — bake provided View services into kit types |
| #2 | Spec — `ServiceOf<Tag>` assignable to each pinned View’s `spec` | Wanted |
| #3 | Kind — array entries’ `kind` partitions card/detail/page | Structural from Handle |

Runtime W14 remains a **last resort** for unpiped / dynamic paths — not the safety net for declared pins.

#### Pipe API — LOCKED: one `Hyperlink.components` + **single array** (owner 2026-07-26)

Not `View.card` / `View.detail` / `View.page` siblings. Not an object `{ card, detail, page }`.

**One combinator, one array** of View handles. Partition at match time by each handle’s `kind` (`"card" | "detail" | "page"`).

```ts
class Special extends WorkPool.Tag<Special>()("app/Special", { payload }).pipe(
  Hyperlink.components([CustomCard, PoolCard, CustomDetail]),
  // CustomCard + PoolCard → card pager (override card binds)
  // CustomDetail → detail allowlist (override detail binds)
  // no page handles in the array → page stays on automatic binds
)
```

| Rule | Behavior |
|------|----------|
| Array present | For each viewKind that appears in the array, that kind’s allowlist **replaces** registry binds |
| ViewKinds absent from array | Stay on automatic `bindTag` / `bindKind` |
| Order within a kind | Pager / multi-match order for that kind |
| Second `.pipe(Hyperlink.components([…]))` | **Replace** the whole pin list (override), not merge |
| Home | `Hyperlink.components` — pin is handle identity; `View.*` stays registry/skins/react |

#### `View.react` — missing skin = Layer `R` is not `never` (owner 2026-07-26)

**Goal:** `View.react(layer)` builds a **usable** React kit (`Card`, `Detail`, `Provider`, …). To do that it must **run** the Layer (e.g. `Effect.runSync` / `runPromise` + `Layer.build`) and read View services from the resulting Context. That only typechecks when the Layer’s remaining requirements are **`never`**.

So the missing-skin error is not a bespoke `ProvidedViews` brand on `<Card tag />` first — it is the normal Effect error:

```ts
View.react(layer)  // layer: Layer<Out, E, R>
// requires R = never (fully provided), or View.react’s signature won’t accept it
```

**How View services show up in `R`:** bind (and pin) contributions **require** the View services they name; chrome Layers **provide** them.

```ts
// Introduces requirements: PoolCard | PoolDetail
const binds = Layer.mergeAll(
  View.bindKind(WorkPool.kind, PoolCard),
  View.bindKind(WorkPool.kind, PoolDetail),
)

// Discharges those requirements (Component = Svc)
const chrome = Layer.mergeAll(
  Layer.succeed(PoolCard, PoolCardView),
  Layer.succeed(PoolDetail, PoolDetailView),
)

const viewLayer = Layer.mergeAll(binds, chrome).pipe(Layer.provideMerge(View.base))
// R = never  ✓

const { Card, Detail, Provider } = View.react(viewLayer)

// Forgot CustomCard provide but bound/pinned it → R still has CustomCard
View.react(Layer.mergeAll(binds, View.bindKind(WorkPool.kind, CustomCard), chrome))
// TYPE ERROR — R is not never (missing Layer.succeed(CustomCard, …))
```

**`Hyperlink.components([…])` pins:** same story — using a pin that names `CustomCard` means that service must be provided before `View.react` (or the compose path that builds the kit) can see `R = never`. Exact wiring (pin → Layer requirement vs pin checked when composing app Layer) bakes at Eng; the **user-facing failure mode** is “can’t `View.react` / run this Layer until every named View service is provided.”

**Mistake corrected:** `View.skins.register(Handle, Comp)` reinvented DI.  
**Right:** `Layer.succeed(PoolCard, Comp)` + `View.react` only on a fully provided Layer.

**Web vs TUI:** each app merges binds + its own `Layer.succeed` chrome, then `View.react` — same View services, different Svc values.

#### View.make / bind → Layer `R` — LOCKED lean (2026-07-26)

```ts
const PoolCard = View.make({
  key: "hyperlink/view/pool-card",
  kind: "card",
  spec: WorkPool.queueControlSpec,
})
// PoolCard is a Context.Service<ViewComponent> + { key, kind, spec }

View.bindKind(WorkPool.kind, PoolCard)
// Layer.effectDiscard: yield* Registry; yield* PoolCard; record bind
// ⇒ Layer<never, never, Registry | PoolCard>

Layer.succeed(PoolCard, PoolCardView)  // discharges PoolCard from R

View.react(layer)  // layer: Layer<Registry, E, never> — runs build (runSync/runPromise)
```

`Hyperlink.components([CustomCard, …])` stamps the array on the HS tag (symbol). Match: if pin present for a kind, use those View services (order preserved); else binds. Pinned services must still be `Layer.succeed`’d into the same layer so `R = never`.


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
  Layer.succeed(PoolCard, PoolCardView),
  Layer.succeed(PoolDetail, PoolDetailView),
  Layer.succeed(CustomCard, CustomCardView),
  View.bindKind(WorkPool.kind, PoolCard),
  View.bindKind(WorkPool.kind, PoolDetail),
  View.bindKind(WorkPool.kind, CustomCard),
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

**Match inputs (no `.view` annotation, no `groupId`):** tag-key bind → stamped `kindOf` bind → fallback. Multi-match = all entries for that **view kind**, ordered (TBD).

**Eng:** View services + `Layer.succeed` + `View.react` (`R = never`); `Hyperlink.components` pin; Page stub OK.

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

**Our lean for views:** EventLog-style registry + `bind*` layers that **require** View services; `Layer.succeed` provides TSX; `View.react(layer)` runs with `R = never`. View Layer **separate** from `Atom.runtime` (W4). Packaging: handles/binds shared; succeeds platform-local (see migration packaging).

### Composability / toolkit (parked detail, keep)

- Slots / layout builder on top of Spec base (parked — not v1; W5).
- `fromSpec` / `fromTag` / `fromFactory` helpers.
- Recipes (`withTrend`, log pane) are UI folds — **not** a second service shape in `data.ts`.
- Replace `QueueService` duplicates over time with `ServiceOf<FamilySpec>`.


### Migration packaging, tree-shaking, and DX helpers (grilling 2026-07-26)

This is a **fairly large migration**. Before moving dashboard widgets, lock packaging + helpers so we do not paint ourselves into a megabundle.

#### Impact of Effect runtime + View registry (read carefully)

| Concern | What happens today / with View.react | Risk if we get it wrong |
|---------|--------------------------------------|-------------------------|
| **When Layer runs** | `View.react(layer)` does `runSync(Layer.build)` **once** at kit construction — not per render | Calling `View.react` inside a component = rebuild registry every render |
| **React tree** | Kit returns `Provider` + matchers; matchers read registry from React context | Must render under `Provider`; no ambient Effect runtime required in the browser for match |
| **Atom.runtime** | Separate (W4) — live data atoms stay on Atom runtime | Do not merge View Layer into Atom.runtime |
| **Tree-shaking** | If one `View.ts` / `base` Layer imports every default Card/Detail TSX, **any** `import { make } from View` pulls all chrome (DOM + Ink risk) | TUI ships web CSS; web ships Ink; huge bundles |
| **Platform** | TSX is `Layer.succeed` in **web** or **tui** app layers | Shared package must export **handles + binds only**; platform owns succeeds |
| **Registry size** | Built Context holds every provided View Svc | Providing unused views = dead weight in memory (usually fine); **importing** unused modules = bundle weight (bad) |

**Rule:** shared modules export View **services** (`make` handles) + bind Layers. Platform modules export `Layer.succeed(Handle, Comp)`. Never put default DOM/Ink components in the shared `View` entry that apps import for `make` / `react`.

#### Namespace vs subpaths (tree-shaking — owner 2026-07-26)

Effect modules are **large namespaces** and still tree-shake when exports are side-effect-free and unused bindings drop. So we **can** share a lot on `View` / family modules — not every symbol needs its own subpath.

| Approach | When |
|----------|------|
| **Fat namespace** (`import * as View` / `View/WorkPool` with many flat exports) | Fine if TSX/platform code is not eagerly imported by shared handle modules |
| **Separate export paths** | Still useful for **platform chrome** (`web/View/WorkPool` vs `tui/…`) and for apps that want a minimal import surface |

**Still banned:** `export const View = { WorkPoolCard }` object-as-namespace (module-layout rule). Prefer flat `export const workPoolCard = View.make(…)` on a module, or `import * as WorkPoolView from "…/View/WorkPool"`.

**Hard rule that remains:** shared handle/bind modules must **not** import DOM/Ink default components. Platform `Layer.succeed` lives in web/tui entry points (subpath or app-local). That — not namespace size — is what keeps TUI from pulling web TSX.


#### Lightweight Group dash — build-time Group → Layer `R` (owner idea 2026-07-26)

**Idea:** a dash with **no built-in components**. You pass the **Group** when **building** the kit (not `tag={…}` on every Card). From the Group’s members, derive every View service required (binds by `kindOf(member)` + any `Hyperlink.components` pins). Those View services appear in Layer **`R`** until you `Layer.succeed` them all — same missing-skin gate as W18, but **scoped to this Group**.

```ts
// No default chrome in the kit — only what this Group needs
const dashLayer = View.group(AppGroup)
// Layer that: knows AppGroup members; requires e.g. PoolCard | PoolDetail | DaemonCard | …
// R = View services for every leaf (from binds + pins)

const ready = dashLayer.pipe(
  Layer.provideMerge(myChrome), // succeed every required View
  Layer.provideMerge(View.base),
)

const { Dashboard, Card, Detail, Provider } = View.react(ready)
// Members already known — Card/Detail are bound to the Group tree
// e.g. <Card name="jobs" /> or Dashboard iterates members without tag={}
```

| | Full `View.react(binds + all chrome)` | Lightweight `View.group(AppGroup)` |
|--|--------------------------------------|-------------------------------------|
| Built-in components | Optional platform “base” succeeds | **None** — you provide what R asks |
| When Group is known | At render (`tag={leaf}`) | **At kit build** |
| Layer `R` | Whatever you bound globally | **Exactly** views needed by this Group’s leaves |
| DX | Generic matchers | Curry Group; smaller provide surface |

**How R is computed (sketch):**

```
for each leaf in Group (recursive):
  if Hyperlink.componentsOf(leaf) → those View services (per kind present)
  else → View services from bindKind(kindOf(leaf)) / bindTag(leaf.key)
  union into R
```

Pins on a member add those services to R even if not in the global bind set. Unpiped members use bind tables — so `View.group(G)` still **requires** the bind contribution layers (or embeds bind lookup) so it knows which View services default chrome needs.

**Flipped helper fits here:** after `View.react(ready)`, `kit.for(member)` or Dashboard-internal curry — tag not passed at each JSX site.

**LOCKED (W20):** offer **both** paths —

1. **Open kit** — `View.react(layer)` + `<Card tag={leaf} />` (current)
2. **Lightweight Group kit** — `View.group(AppGroup)` → Layer with precise `R` → provide chrome → `react` → Dashboard/Cards closed over that Group

Migrate widgets can start on (1); (2) is the “bring your own chrome, Group drives requirements” product.

#### `View.react` → also `Dashboard`? — OPEN lean

Returning `Dashboard` from the same kit is attractive for migration (`widgets={forKind…}` → View Layer).

| Option | Shape | Note |
|--------|--------|------|
| **A** | `View.react(layer)` → `{ Card, Detail, Page, Dashboard, Provider, … }` | One kit; Dashboard closes over same registry |
| **B** | `View.dashboard(layer)` separate from `View.react` | Clearer split; two runSync if both used carelessly |
| **C** | Keep Dashboard in `web`/`tui`; only consume kit matchers | Least coupling; slower migration |

**Lean:** **A** — `Dashboard` on the kit once `Card`/`Detail` parity exists; shell stays platform-specific (routing, Ink vs DOM) but **member chrome** goes through the kit. Do not block handle/bind Eng on Dashboard.

#### Flipped helper: `Hyperlink.react(MyService)` — OPEN (strong DX)

Owner idea: flip the matcher — given a **service**, get components already bound to it:

```ts
const { Card, Detail, Page } = Hyperlink.react(MyQueue)
// <Card />  — no tag prop; always MyQueue
// <Detail />
```

vs today:

```ts
const { Card, Provider } = View.react(viewLayer)
<Card tag={MyQueue} />
```

**How it can work without a second registry:**

```ts
// Needs a kit / Provider in scope for skins (same Layer R=never story)
const kit = View.react(viewLayer)

const { Card, Detail, Page } = kit.for(MyQueue)
// or Hyperlink.react(MyQueue, kit)
// or Hyperlink.react(MyQueue) reading ambient View Provider (hooks)
```

| Piece | Job |
|-------|-----|
| `View.react(layer)` | Build registry once; `R = never`; return matchers + Provider (+ Dashboard later) |
| `kit.for(tag)` / `Hyperlink.react(tag)` | Curry `tag` into Card/Detail/Page — props become `{ name? }` only |
| Skins | Still from the same Layer / Provider — flipped helper does **not** invent provides |

**LOCKED (lean):** `kit.for(tag)` on the `View.react` result (no Hyperlink↔ui cycle). Alias `Hyperlink.react(tag)` later only if it can live without importing UI (unlikely) — otherwise keep flipped helper on the View kit or `hyperlink-ts/ui` as `View.for(tag, kit)`.

Name collision: `Hyperlink.react` vs `View.react` — different jobs (service-bound vs layer kit). Document clearly if both exist.

**Eng note (W20 R):** `View.group` alone does not invent bind tables — merge `View.bindKind` / `View.bindTag` for default chrome `R`. Pin-only Views (on leaves, not in binds) → merge `View.requireView(Pin)` (discover with `View.pinnedViewsOf(group)`). Runtime walk cannot auto-union pin types into Layer `R`.

#### Migration order (proposed)

1. Keep Eng’d core (services, succeed, react R=never, components pin) — **done**
2. ~~W20 `View.group` + `kit.for(tag)`~~ **done**
3. Lock packaging: shared handles/binds subpaths; platform succeed layers — **now**
4. Migrate WorkPool Card+Detail to View services + web/tui succeed layers
5. Kit `Dashboard` (or web/tui Dashboard consumes kit)
6. Delete `forKind` / `ui/data` QueueService duplicates over time

### LOCKED decisions (2026-07-26)

| # | Decision |
|---|----------|
| W1 | Keys `hyperlink/view/<name>`; uniqueness enforced at `register` |
| W2 | Explicit pin via **`Hyperlink.components(View[])`** on the HS handle — not Tag `.view` field (parked) |
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
| W13 | **View = Context service; TSX = Layer-provided Svc** — not `register(handle, Comp)` map; `Layer.succeed(View, Comp)` is the skin seam |
| W14 | Runtime skip-at-match = **last resort** (unpiped/dynamic). Declared binds/pins → must be provided (`View.react` `R = never`) |
| W15 | **No `groupId` in View/UI dispatch** — RPC wire only. Family bind = stamped `kindOf` (`hyperlink-ts/WorkPool`, …). Kill `bindFactory` / short `"queue"`\|`"pool"` kinds |
| W16 | Pipe allowlist on service tag (symbol bag); present kinds **replace** binds; order within a kind = pager |
| W17 | View handles on HS tag are **opt-in override only** (not defaults). Default chrome = registry binds. **When piped**, type-check pins |
| W18 | **Missing skin = `View.react(layer)` requires Layer `R = never`** — binds/pins require View services; `Layer.succeed(View, Comp)` provides them; react runs the Layer to emit components |
| W19 | Pipe API = **`Hyperlink.components(Handle[])`** — single array, partition by `handle.kind`; not card/detail/page siblings; not `{ card, detail }` object |
| W20 | **`View.group(AppGroup)`** — lightweight BYO-chrome dash: Group at kit build → Layer `R` = View services for leaves (binds + pins); no built-in components; provide chrome then `View.react`. Keep open kit (`react(layer)` + `tag={leaf}`) alongside |

### Eng order (next)

1. ~~View services + react R=never + Hyperlink.components~~ **done**
2. ~~W20 `View.group` + `kit.for(tag)`~~ **Eng’d** — `View.group(AppGroup)` stashes GroupDash; merge `bind*` for default `R`; pin-only → `View.requireView` / `pinnedViewsOf`; `react(…).for(tag)` → bound Card/Detail/Page
3. Packaging — shared handles/binds; platform succeed layers (no TSX in shared imports); fat namespace OK
4. Migrate WorkPool Card/Detail
5. Kit `Dashboard` optional (open)
6. Retire `forKind` / `ui/data` service dupes
7. `Hyperlink.atom` / `query` / `fn` in parallel
8. Desktop tabs + real Page kind — later

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

View services + Layer-provided TSX; `Hyperlink.components([…])`; `View.react` `R = never`. Eng skeleton; Spec gate + Group later. TanStack / Promise adapter still on table.
