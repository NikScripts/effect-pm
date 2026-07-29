# Examples apps (E5) — refactor + docs plan

**Status:** draft for owner lock (2026-07-29).  
**Branch:** `cursor/hyperservice-open-deps-5679`.  
**Extends:** [`agent-01-examples-book.md`](./agent-01-examples-book.md) (E0–E4 done).  
**Does not touch:** sidebar IA (L6) — separate lock.

---

## Problem (why apps break the book)

The examples book assumes:

> one runnable file → one idea → Twoslash `include=` + in-file cuts

The leftover **apps** violate that:

| Failure mode | Where it shows up |
|--------------|-------------------|
| **Thin entry / fat guts** | `counter-tui.tsx` (13) → `dashboard-mock` (726); `main.tsx` (13–16) → servers 379–490 |
| **Product line, not a form** | `examples/apps/tui` ≈ 12 `pnpm` scripts, overlapping demos |
| **Multi-process** | `examples/apps/web` needs vite **and** `server.ts` |
| **Wrong medium for Twoslash** | Ink/React mounts; docs pipeline is TS-fence + Effect hover |
| **Other-agent holds** | Agent G: View compose + Dashboard chrome peel (K2); Agent B: dashboard typesafety |

Dumping every `.tsx` into `include=` either shows a useless launcher or a novel.

---

## Taxonomy (proposed lock)

| Kind | Path pattern | Docs treatment |
|------|--------------|----------------|
| **Topic form** | `examples/<topic>/**` | 1:1 `include=` (done; IA reorg) |
| **Scenario** | `examples/scenarios/**` | Entry `include=` + prose (E4 done) |
| **App** | `examples/apps/{tui,web,dashboard,cli,queue-widget,view-compose}` | **Not** 1:1. One **app page** per product (below) |
| **Scratch / POC** | `examples/apps/view-scratch/*`, atoms sketch | No book page (IDE/handoff only) |
| **Harness** | `examples/shared/**` | Never paired |

**App page** (new doc shape — not a form dump):

1. Short “what this dogfoods” (2–4 sentences)
2. **Run matrix** (`pnpm run example:…` for server + UI)
3. Architecture sketch (who talks to whom) — mermaid ok
4. Optional Twoslash: **only** extracted non-UI modules (contracts, `hub.ts`, queue wiring) via `include=`
5. Link into forms that teach the same APIs

Hub section today (“Apps not 1:1 paired”) becomes a real **Apps** index once pages exist.

---

## Per-app disposition

### A. Promote now (form-like — small Eng, high clarity)

| Target | Action |
|--------|--------|
| **`apps/cli`** | Pair `counter-cli.ts` (+ optional manager) as `docs/examples/apps/cli/…` with `include=`. Already one-shape. |
| **`apps/atoms`** | Tip-check vs shipped atoms APIs first. If still the teaching SSOT → pair as one form. If superseded by `src/` → delete or move under `shared/` / archive; do not teach a fork. |

### B. Refactor then scenario-page (real E5 Eng)

#### `examples/apps/web`

**Today:** teachable mesh is buried in `server.ts` (490) + `hub.ts` (219); browser shell is empty.

**Refactor:**

1. Keep **`hub.ts`** as the Tag / port / contract SSOT (already half there).
2. Split **`server.ts`** into:
   - `wnba-layer.ts` (or similar) — Layer graph only, no `NodeRuntime.runMain` — **include-able**
   - `server.ts` — thin `runMain(Layer.launch(…))`
3. Browser stays Vite; **no** Twoslash on `main.tsx` / `app.tsx`.

**Doc:** one app page — include `hub.ts` + `wnba-layer.ts` (cuts for noise); run both scripts.

#### `examples/apps/tui`

**Today:** many scripts; Ink entries are side-effect mounts; fat mocks.

**Refactor (collapse + extract):**

1. **Script taxonomy** (owner pick names; default proposal):
   - **Core:** `example:apps-tui` (counter), `example:apps-tui-grid`, `example:dashboard` (or one dashboard entry)
   - **Queue demos:** keep `queue-live` / `queue-mock` / `queue-logs` **or** fold into one `example:apps-tui-queues` with a flag — owner call
   - Drop confusing aliases once hub uses `example:apps-*` only
2. Extract **non-JSX** wiring where it exists (`live-queues.ts`) as include targets.
3. Ink UI files (`*-app.tsx`, `*-mock.tsx`) stay **out of Twoslash** unless we later add a JSX Twoslash policy (out of scope).
4. Kit `<Dashboard />` is unheld — app-page SSOT may teach the one-liner + chrome; counter/grid/queue pages can proceed; node-status page peel still Agent G (K2 slice 2).

**Doc:** 1–3 app pages max (Counter TUI, Queues TUI, Dashboard TUI when unblocked) — not twelve.

#### `examples/apps/dashboard` + `queue-widget`

**Today:** dogfoods shipped `<Dashboard>` + Atom runtime; UI kit noise; Agent B/G overlap.

**Refactor:**

1. Extract **`fleet.ts` + `queue-data.ts`** (runtime + Group tree) as the include-able teaching surface.
2. `main.tsx` / shadcn `components/ui/**` never in the book.
3. `queue-widget`: extract `queue-atoms.ts` if it teaches a distinct projection; else fold into dashboard app page as “also see”.

**Doc:** one **Web dashboard** app page after Dashboard hold lifts (or a “runtime wiring only” draft that does not claim UI SSOT).

#### `examples/apps/view-compose`

**Disposition:** **Agent G only.** No examples-book page until compose lock says the proto is the public teach. Hub may link to their guide (`view-tag-types` / `view-data`) instead of the proto tree.

### C. Leave unpaired / archive

| Target | Action |
|--------|--------|
| **`apps/view-scratch/hover-types.ts`** | IDE scratch — cite from handoffs; no hub page |
| **`apps/view-scratch/effect-service-poc.ts`** | Historical POC — archive or delete when G confirms shipped View supersedes it |

---

## Work batches (after owner lock)

| Batch | Work | Depends on |
|-------|------|------------|
| **E5-0** | Lock taxonomy + per-app disposition (this doc) | **owner** |
| **E5-1** | CLI (+ atoms tip-check) → include book | E5-0 |
| **E5-2** | `apps/web` split (`hub` + layer + thin server) + one app page | E5-0 |
| **E5-3** | `apps/tui` script collapse + extract non-JSX + 1–2 app pages (no dashboard until hold lifts) | E5-0; dashboard page waits on **G** |
| **E5-4** | `apps/dashboard` / `queue-widget` extract + one app page | E5-0; **G/B** hold |
| **E5-5** | `apps/view-compose` / `view-scratch` cleanup | **G** |
| **E5-6** | Hub **Apps** section + `examples/README` tracks aligned | after E5-1+ |

No `nav.ts` spam — app pages stay hub-linked like forms.

---

## Explicit non-goals

- Twoslash every Ink/React file
- Moving apps back into topic folders
- Sidebar IA reshuffle (L6)
- Competing with Agent G’s Dashboard / View compose SSOT

---

## Owner lock checklist

Reply with choices (defaults in **bold**):

1. **Taxonomy:** accept Topics / Scenarios / Apps / Scratch as above? (**yes** / amend)
2. **CLI:** pair into book now? (**yes** / later)
3. **Atoms:** tip-check then pair or delete? (**tip-check then decide** / pair / delete)
4. **TUI scripts:** collapse to ~3 product entries? (**yes** / keep all scripts, fewer docs)
5. **Dashboard / apps/web docs:** wait for G hold? (**yes — wait** / draft wiring-only page now)
6. **apps/view-compose:** leave to G? (**yes** / scenario page now)
7. **apps/view-scratch POC:** archive/delete when G ok? (**yes** / keep forever unpaired)

---

## Verification (when Eng’d)

- `pnpm exec tsx docs/site/scripts/check-twoslash-includes.ts` stays green
- Each new app page: run matrix commands smoke locally
- No include of `components/ui/**`, Vite `main.tsx`, or Ink `render(` entries unless policy changes
