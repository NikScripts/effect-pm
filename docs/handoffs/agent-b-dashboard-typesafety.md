# Agent B — Dashboard type-safety remediation

**Agent:** Agent B (dashboard / web owner)
**Branch:** cut `fix/dashboard-typesafety` from `integration/storage`, advance by merge.
**Scope:** `src/web/*` and `src/ui/*` (the shipped dashboard). Nothing else.
**Origin:** found by Agent C's standards audit. This doc is the complete spec — you should not need the audit chat.

---

## Start here — PLAN FIRST, nothing without approval

**Your first reply is your plan, and only that. Then you stop and wait for the owner's explicit go.**

Everything is run by the owner before you do it — do **not** cut the branch to write code, implement
a fix, add a guard, or open a PR until they approve. Present, wait for a clear "go", act one step at
a time. A "sounds good" or your own certainty is not approval.

Your opening plan covers:
1. **Approach per work item (1–6 below)** — how you'll fix each: the guard shapes, the `specOf`
   signature change, exactly where the one runtime-`R` boundary cast lands and its proof, how you'll
   type the seeds. Say where you'd do it differently.
2. **Order & ripple** — what you touch first; what leaves `src/web`/`src/ui` (e.g. `specOf` lives in
   `../Resource` — changing its signature touches the engine, which is **not** your scope; flag it
   and propose, don't just edit).
3. **Open questions** — anything ambiguous before you rely on it.

Then stop. Show every subsequent change as full Before/After per
[`supervisor-protocol.md`](./supervisor-protocol.md) — one step, each approved first.

---

## Why this exists

The dashboard is a **runtime-discriminated subsystem**: the group tree is erased to `unknown`
(`src/web/data.ts` — `GroupNode.members: Record<string, unknown>`), and concrete tag types are
recovered at runtime by `kindOf`. Today that recovery is done with `as` casts, which violates
`types-and-naming.fix-root-cause` / `narrow-with-validation`. There is also one runtime-`R` erasure
in `runtime.tsx` currently spelled as `any` + an `eslint-disable`.

The debt is small and contained (~19 `as` + 1 explicit `any` across `web`+`ui`), so this is
**targeted hardening, not a rewrite**. Do **not** make `GroupNode` generic over `R`: runtime
discrimination is intrinsic to a heterogeneous resource tree, so a generic tree would not remove the
discrimination — type-guards are the correct tool.

`kindOf` (`data.ts:237`) keys off the contract's **stamped `kind` field** (`resourceKindOf`) — a
structural discriminant, exactly what `types-and-naming.classify-by-field-not-brand` wants — so it
can back sound type-guards. That is the linchpin of the whole fix.

---

## Work items

### 1. Type-guards instead of discrimination casts (the main fix)
Add guards next to `kindOf`, keyed off the same stamped `kind`. They narrow a **group member** (all
`leafTags` inputs are real tags), so `kindOf` need not be total over arbitrary `unknown`:

```ts
export const isQueueTag = (m: unknown): m is QueueTag => kindOf(m) === "queue";
export const isProcessTag = (m: unknown): m is ProcessTag => kindOf(m) === "process";
export const isApiTag = (m: unknown): m is ApiTag => kindOf(m) === "api";
```
Then remove the casts they replace:
- `data.ts:530` — `leafTags(node).filter((m) => kindOf(m) === "queue") as ReadonlyArray<QueueTag>`
  → `leafTags(node).filter(isQueueTag)`.
- `data.ts:534` — same for `processLeaves` → `filter(isProcessTag)`.
- Any `apiLeaves`/equivalent → `filter(isApiTag)`.
- `data.ts:526` — `leafTags(m as GroupNode …)` → narrow with the existing `Group.isGroup` guard so
  the branch types `m` as the group node with no cast.

### 2. Kill the double-cast inside `kindOf`
`data.ts:244` — `const spec = specOf(member as Parameters<typeof specOf>[0]) as unknown as FlatSpec;`
Give `specOf` an honest signature (or a small typed wrapper / guard) so neither the argument cast nor
the `as unknown as FlatSpec` is needed. `specOf` lives in `../Resource`; fix it at the source if its
public signature is the reason a cast is forced here.

### 3. Typed seed values
`data.ts:335,354,447` — `undefined as QueueStatus | undefined` (and the `QueueMetrics` /
`ApiUsageMetrics` siblings). Replace with a typed seed — either annotate the accumulator field, or a
tiny `const seed = <A>(): A | undefined => undefined` used as `seed<QueueStatus>()`. No `as`.

### 4. The RPC-protocol cast
`data.ts:472` — `Layer.provide(Layer.effect(RpcClient.Protocol, node as NodeKey<never>))`. Investigate:
if `node`'s type genuinely cannot be expressed against `RpcClient.Protocol`, this is a real
`boundary-cast-last-resort` — keep **one** cast **with a one-line proof comment**. Otherwise fix the
type so it goes away. Do not leave it bare.

### 5. The runtime-`R` boundary (`src/web/runtime.tsx`)
This is the one **irreducible** erasure: a consumer's `AtomRuntime<R, ER>` must live in a
module-level (monomorphic) React context and be paired with `unknown`-recovered tags. After item 1,
widgets operate on erased tags, so:
- Type the context/`useRuntime` as the **erased** runtime (`Atom.AtomRuntime<never, never>` or a
  no-param `DashboardRuntime`) — **not** `any`. Remove the `eslint-disable` and the `any`.
- Keep `RuntimeProvider` **generic** (`<R, ER>(props: { runtime: DashboardRuntime<R, ER> … })`) so
  the consumer's runtime is still type-checked at entry.
- Perform the erasure at exactly one spot with a proof comment — a single
  `boundary-cast-last-resort` (`as unknown as` **or** a named assertion), justified by: *React
  context is monomorphic and nothing downstream reads `R` (the tree is already requirement-erased),
  so there is no runtime footprint to validate.*
- Do **not** ship a propagating `any` type, and do **not** hide the erasure behind an empty
  `asserts` function typed `(x: unknown)` — that launders an unchecked assertion. If you use an
  assertion, it must be this single, named, documented boundary.

### 6. Hygiene (same files, `must` + `should`)
- **Remove every `@since 1.0.0`** — nothing is locked yet, so each is an illegal unapproved lock
  (`no-backward-compat`, a `must`). Counts: `widgets.tsx` (46), `atom-react.tsx` (6),
  `Dashboard.tsx` (5). (`runtime.tsx` already done on `chore/standards-audit`, commit `4f607b16`.)
- **Add `@public`** to exported dashboard symbols (`effect-style.mark-the-surface`, a `should`).
- **Suppression comments** (`no-backward-compat.no-suppression-comments`): each bare
  `@effect-diagnostics-next-line …:off` (`debug-console.tsx:28,104,133`, `now.ts:12,25`,
  `widgets.tsx:448`) either gets a one-line reason **and** is genuinely unavoidable, or the
  underlying diagnostic is fixed and the suppression removed. Prefer removal.

---

## Acceptance criteria

- No `as` / `satisfies` / `!` / explicit `any` in `src/web` + `src/ui` **except** documented boundary
  casts (items 4–5), each carrying a one-line proof comment. Verify: `rg -n '\bas [A-Z]| as unknown| as any|satisfies' src/web src/ui` returns only the commented boundaries.
- New `*.test-d.ts` pinning the guards (`isQueueTag(x).returns …`) and the public `Dashboard` /
  `DashboardView` / `RuntimeProvider` types — **with no casts**, per
  `working-agreement.test-d-for-public-types`.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green; effect-language-service clean
  (`effect-language-service diagnostics --file …` on the changed files).
- Show every change as full Before/After per [`supervisor-protocol.md`](./supervisor-protocol.md);
  commit + push continuously; update [`agent-status.md`](./agent-status.md) on each push.

## Out of scope

- `examples/apps/dashboard/*` (e.g. `cache.ts` `@since` locks) and the `examples/*` suppressions —
  a separate example sweep, not this branch.
- Engine internals (`src/internal/*` `satisfies`, `Store.ts` boundary casts) — Agent C.
- Any behavioural change to widgets. This is types + doc-comment hygiene only; the rendered dashboard
  must look and behave identically.
