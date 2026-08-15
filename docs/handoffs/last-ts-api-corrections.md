# last-ts API corrections (owner 2026-08-08)

**Status:** LOCK — agents must obey; supersedes Agent G / Agent K handoff prose that disagrees  
**Branch:** `cursor/agent-k-page-route-6d0e`  
**Process:** confirm actions before Eng; (re)read `docs/standards/` first (`confirm-handoff-actions`)

---

## Why this exists

Agents (G, then K) Eng’d and *taught* APIs that were never owner-approved: Vite
`pageConfig`, on-disk / engine `getConfig`, `Page.asDefault`, Page introspection
helpers, Route `fromEffect` / `fileRootFromPages` bake stacks, and examples that
presented those as the product surface. Owner rejected them. This file is the
SSOT for what is banned and what must be renamed.

---

## Locked renames

| Wrong | Right |
|-------|--------|
| `View.make` | **`View.make`** (HttpApi-shaped mint, same family as `Router.make` / `Page.make`) |

`View.make` was never the locked name. Docs/examples that still say Service are
stale — fix on sight.

---

## Forbidden (do not resurrect)

| Banned | Why it appeared (log only — not approval) | Correct direction |
|--------|---------------------------------------------|-------------------|
| **Direct `waku` / `waku/*` imports in apps** | Agents treated Waku as the app framework (fs-router + `getConfig`) | **Apps import only `last-ts/*`.** `waku` is an optional peer inside last-ts (`last-ts/config`, `last-ts/Waku`; host entry uses Waku `createPages` internally). |
| **`getConfig` anywhere** (app file, `Page.getConfig`, Vite inject `pageConfig`, “Waku’s own getConfig on that file”) | Symptom of using Waku’s fs-router | Impossible / irrelevant when apps never use that router. Never author `getConfig`. |
| **`pageConfig` Vite plugin** | Interim inject bridge | Deleted; stays deleted |
| **`Page.asDefault`** | Bridge so Waku fs-router accepts a class default export | Not approved; do not reintroduce |
| **`static Component` on Page classes** as the app pattern | Mimicked React class fields for RSC file modules | Not approved teaching shape |
| **`Page.modeOf` / `optionsOf` / `extract` / `paramBagsOf` / `configOf`** (+ `WakuConfig` helper surface) | Adapter/test helpers for the inject/`getConfig` bridge and catalog merge | Unapproved public API — **deleted**. Revisit only via owner lock + correct process |
| **`Route.fromEffect` / `staticFromEffect` / `mixedFromEffect` / `Route.fromPage`** (top-level Page-class catalog bake) | Catalog bake / Page-class merge invented on the branch | Unapproved — **deleted**. **Not** `Group.fromEffect` / `group.from` — those stay core public (HttpApi dual; fileRouter / `Route.fileRoot` builds on them). |
| **`Route.fileRootFromPages` / `Router.fileSystemFromPages` / `destinationsFromPages` / `pagesByIdFromModules`** (and siblings that exist only to merge **Page classes** into the file table) | Dogfood shortcut | Unapproved — **deleted**. Distinct from path-table `Route.fileRoot` / `group.fromEffect`. |
| Teaching **`Shell.layer.pipe(Layer.provide(…))`** as the house style | Reads as a triple chain | Prefer `pipe(Shell.layer, Layer.provide(…))` (or other rearrangement). Avoid long `.a.b.pipe` chains without a visual break |

---

## Approved direction (do not invent past this)

Follow **[`router-httpapi-lock.md`](./router-httpapi-lock.md)** for Router / Route / RouterBuilder:

- `Router.make` / `Router.group` / `Route.get(…, { params, … })`
- Handlers: `Effect → ReactNode` (and documented overloads)
- `Page.Request` / `Page.document` (+ `Document.*` / `Page/react` bridges) for request + **document title**
- `Last.provider(layer)` — one children-only provider baked from the Layer graph
- `View.make` + const `Layer.effect` / `Last.provide(Tag, layer)` + Layers for DI components
  (no `static layer` / `Tag.layer` teaching)
- `History` / `Memory` / `Waku` as transport namespaces (`fromApi` / `.layer`)

### Eng’d locks (do not invent past these)

| Lock | Surface |
|------|---------|
| [`page-document-lock.md`](./page-document-lock.md) | `Page.document`, `Document.make` / `provide` / `transform` |
| [`page-layout-lock.md`](./page-layout-lock.md) | `RootLayout` / `Layout.make` / `Layout.provide` / `Outlet` |
| [`page-mint-lock.md`](./page-mint-lock.md) | `Page.make` / `Page.static` + `Route.static`; no path on mint |
| [`last-provider-lock.md`](./last-provider-lock.md) | One `Last.provider(layer)` bake |
| [`file-router-lock.md`](./file-router-lock.md) | Path-only `paths.gen`; no catalog-merge APIs |
| [`last-ts-spine.md`](./last-ts-spine.md) | Canonical teaching walkthrough |

### Do not Eng from vibes

- Catalog-merge / Page-class bake into Router (`*FromPages`, etc.) — **forbidden**
- Extra nested product providers beyond `Last.provider`
- View.make redesign (parked)

---

## Agent rules (repeat)

1. Handoff ≠ go. List actions; wait for confirmation.
2. (Re)read `docs/standards/` before Eng.
3. Build from **this file + router-httpapi-lock + owner decisions** — not from Agent G tip prose, not from “sensible next improvements,” not from Waku docs.
4. If a constraint pushes you toward importing `waku`, `getConfig`, inject, or asDefault — **stop and raise it**. The fix is the last-ts façade, not a Waku app API.

---

## Host boundary (locked)

| App imports | last-ts only |
|-------------|--------------|
| Config | `last-ts/config` (`defineConfig`) — file may still be named `waku.config.ts` for the CLI |
| RSC server entry | **Do not teach** Waku `createPages` / `createRoot` / `createLayout` in apps. Host entry wires those; not product API. Product: Page / RootLayout / Last.provider / catalog. |
| Soft-nav transport | `last-ts/Waku` |
| Path codegen | `last-ts/vite` `fileRouter` → `paths.gen.ts` |

Hyperlink `docs/site/**` cut over — same host boundary as Last site (no app `waku`).

---

## Do not resurrect

- App-level `import … from "waku"` / `"waku/…"`
- `getConfig` / `pageConfig` / `Page.getConfig`
- `Page.asDefault` / Page introspection helpers listed above
- Route `fromEffect*` / `fromPage` / `*FromPages` catalog merges
- Teaching `View.Service` as the public mint name (use `View.make`)
