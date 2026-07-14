# Agent D — Named resource handles (compact hover + expand-on-demand)

**Branch:** cut `action/named-handles` from `integration/storage`; advance by merge.
**Role:** make each resource's handle hover as a **compact named type** (`QueueHandle<EmailJob>`)
while the **full member shape stays recoverable** — in the editor via the owner's prettify-ts
extension, and in the docs via the D3 popover port (below).
**Docs bus:** update [`agent-status.md`](./agent-status.md) on every push.

---

## Start here — PLAN FIRST, nothing without approval

Your first reply is your **plan for Phase 1 only**, and nothing else. Then you stop and wait for
the owner's explicit go. A "sounds good" or your own certainty is not approval. No branch, no code,
no PR until the owner says go. One step at a time.

**Hard constraints (the owner will hold you to these):**
- **No `as` casts anywhere.** Fix the root cause structurally.
- **Additive / structural-identity only.** A named handle is `interface XHandle … extends ServiceOf<…> {}`
  — the *same shape*, aliased. Every existing consumer (`src/web/data.ts`, the widgets, tests) must
  still typecheck unchanged. Do **not** rename exported types.
- **Commit AND push every step** (a local commit isn't done until it's on origin).
- Tests need no permission — write them thoroughly.

---

## The goal, precisely

`yield* Emails` today hovers as the fully-expanded `ServiceOf<…>` object (clean members — see
"What already shipped"). The owner wants the **default** hover to read as a compact name —
`QueueHandle<EmailJob>` — with the members one expand away. This is not cosmetic: it lets the API
name types cleanly *without* hiding the shape, because the shape is always recoverable two ways:

1. **Editor:** the owner runs **prettify-ts** (`mylesmurphy.prettify-ts`), which expands any type
   under the cursor via the TS compiler API — regardless of aliases. So *named handle + prettify-ts
   = compact name AND full shape*, for free, the moment the handle is named.
2. **Docs:** the D3 popover port (separate track below) reproduces that expansion for readers who
   don't have the extension.

**Verified already** (owner watched it render on mobile): the dual view works. A named `interface`
hovers as its name; the same type expanded shows all members. Proof page: `docs/guides/type-previews.md`
(reachable at `/docs/type-previews`, not in nav — delete or fold once D3 lands).

**The one rule that shapes everything:** a type only *expands* in a hover when it arrives by
**inference** or through a compiler-API walk. A **written** annotation is echoed as-written:
`declare const x: Prettify<Handle>` shows `Prettify` (alias preserved), and
`declare const x: { [K in keyof Handle]: Handle[K] }` shows the mapped-type *expression*. Only
`const x = expand(handle)` (return-type inferred) resolves to concrete members. This is why the
docs expansion (D3) must be a compiler-API port, not a type alias.

---

## What already shipped (context — do not redo)

On `integration/storage`, cast-free, gate green:
- **`Simplify` on `ServiceOf`** — members resolve from `Method<…>` spec descriptors to real effects
  (`add: (payload) => Effect<void>`, `size: Subscribable<number>`).
- **`PrettifyPayload`** — decoded payloads read `{ to: string }` (no `Schema.Struct.ReadonlySide<…>`,
  no `readonly`) at the payload position. `Resource.Decoded<S>` exposes a schema's prettified `.Type`.
- **`Client<T>` override API** — `effectFn<T>()(schema)` / `effect<Effect<T>>()(success)` (narrowing),
  `unsafeEffectFn<T>()(schema)` / `unsafeEffect<…>()(success)` (free). The queue's `add`/`prioritize`/
  `defer` use this and read as real `(item)` / `(items[])` overloads.
- **`Kind` type param dropped** — `Method<P, Su, E, Str, Ann, Client>`; `kind` is runtime-only now.

See [`agent-a-type-display-cleanup.md`](archive/2026-07/agents/agent-a-type-display-cleanup.md) for the full record and the
**payload-prettify backlog** (nested entry `item`, other resources' overloads, verbose-type sweep) —
that backlog pairs naturally with each resource's handle work below.

---

## Phase 1 — foundation (ONE agent, serial). This unblocks the fan-out.

Prove the pattern on the **queue** (the golden model), and land any shared seam **once** so the
fan-out never touches `Resource.ts`.

1. **The seam.** The Tag's value type is `ServiceOf<S, Self>` at
   `src/Resource.ts:1727` (`ResourceTag … extends Context.ServiceClass<Self, string, ServiceOf<S, Self>>`).
   Because that's a raw mapped type, `yield* Tag` expands. To get a name, the queue's service type
   must resolve to a **named interface** — e.g.:
   ```ts
   export interface QueueHandle<T> extends ServiceOf<QueueSpec<T>> {}
   ```
   (Confirm the exact spec expression in `src/QueueResource.ts` — the per-instance spec built from
   `itemSchema`.) Thread it so `QueueResource.Tag<Emails>()(...)` surfaces `QueueHandle<EmailJob>`.
   Decide in your plan **where** the naming is applied: a queue-specific Tag return type, or a general
   opt-in seam on `ResourceTag` that a resource passes its named view into. Prefer the smallest change
   that keeps `Resource.ts` generic; if a shared seam is needed, land it here and freeze `Resource.ts`.
2. **Additive.** `QueueHandle<T>` must be structurally identical to today's service type. Confirm
   `src/web/data.ts` and the widgets still typecheck with zero edits.
3. **Verify the hover** — headless probe (mirrors the editor; resolves to `dist`):
   ```
   paths: { "@nikscripts/effect-pm": ["dist/index.d.ts"], "@nikscripts/effect-pm/*": ["dist/*.d.ts"] }
   ls.getQuickInfoAtPosition(<the `const emails = yield* Emails` name>)  // expect: QueueHandle<EmailJob>
   ```
   Then the owner confirms in prettify-ts (name + expanded).
4. **Write the template.** Add a "Fan-out template" section to this file (or a sibling) with the exact
   pattern the Phase-2 agents copy. Commit + push.

**Done when:** `yield* Emails` hovers as `QueueHandle<EmailJob>`; prettify-ts expands it to the clean
members; `typecheck 0 / lint 0 / test` green; consumers untouched.

---

## Phase 2 — fan-out (ONE agent per resource, parallel, isolated files)

`Resource.ts` is frozen after Phase 1. Each agent copies the queue template into **one** resource file
and its test — nothing else:

| Handle | File |
|--------|------|
| `ProcessHandle` | `src/Process.ts` |
| `RunResourceHandle` | `src/RunResource.ts` |
| `StoreHandle` | `src/Store.ts` |
| `MetricsHandle` (ApiMetrics) | its module |

Each agent: define the named interface over the resource's `ServiceOf<…>`, thread it, verify the hover
(probe + prettify-ts), add a test, keep it additive (no export renames), commit + push. **Collision
rule:** touch only your resource's file + test; never `Resource.ts`; never another resource's file.

While in each file, optionally fold in that resource's slice of the payload-prettify backlog (enqueue
overloads via `unsafeEffectFn`, verbose status/config structs) — see the type-display handoff.

---

## Doc-UI track — the dual view (D3 + D4). Separate agent; depends on nothing above except the demo.

- **D3 — dual preview in the twoslash popover.** Port prettify-ts's compiler-API expansion into the
  docs twoslash transformer (`docs/site/src/lib/highlight.ts`) so one popover shows the **compact name
  and the expanded shape together** (prettify-ts merges them into a single hover; the demo page shows
  them as two stacked popups — D3 merges them). Because a written `Prettify<Handle>` won't expand (see
  "the one rule"), this must be a compiler-API walk, not a type. This is the owner's **top-priority**
  doc-UI item.
- **D4 — hover types on module mentions in prose** (depends on D3). Build a symbol→type index at build
  time (compile a module importing the public surface, harvest each export's `{alias, expanded, docs}`
  with the checker) and a rehype pass that wraps prose mentions with the same popover. **Open decision
  for the owner:** how a mention is matched — auto-match every inline `` `code` `` (false positives),
  explicit `[[Module.member]]` marker (no false hits, manual), or auto-match only qualified
  `Module.member` spans (recommended).

---

## Verification gotchas (these cost real hours)

- **Editor reads `dist/*.d.ts`**, not `src` (via `package.json` exports). After every `src` change:
  `pnpm build` **and** restart the TS server. Beware stale copies (`short-box/node_modules/@nikscripts/effect-pm`, `effect-pm-alt`).
- **Docs twoslash reads `src`** but the dev server caches per-process — restart 5190; the dev server
  sends no cache headers, so load `/<path>?v=N` on the phone to bypass the browser cache.
- **Named vs inline vs written vs inferred:** a named alias hovers by name; an inline structural type
  expands; a **written** annotation is echoed verbatim; only an **inferred** type resolves a mapped
  type to members. (This is the whole game.)

---

## Kickoff prompt

> You are **Agent D**. Read `docs/handoffs/agent-d-named-handles.md` in full. Goal: make resource
> handles hover as a compact named type (`QueueHandle<EmailJob>`) while keeping the full member shape
> recoverable (prettify-ts in the editor, D3 in docs). Do **Phase 1 on the queue only** — define the
> named `QueueHandle<T>` over the queue's `ServiceOf`, thread the `ResourceTag` seam
> (`src/Resource.ts:1727`) so `yield* Emails` hovers as `QueueHandle<EmailJob>`, keep it additive
> (consumers must typecheck unchanged, no export renames, no `as` casts), verify with the headless
> quick-info probe, then write the fan-out template. **PLAN FIRST:** your first reply is the Phase-1
> plan and nothing else — wait for the owner's explicit go before any code. Branch `action/named-handles`
> from `integration/storage`. Commit and push every step.
