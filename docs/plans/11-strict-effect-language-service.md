# Strict `@effect/language-service` rules

**Status:** Planned (implementation backlog)

**Context:** `tsconfig.json` enables the `@effect/language-service` plugin with most diagnostics at `"error"`. Two rules are temporarily set to `"off"` so the project stays typecheck-green while we fix the underlying patterns:

- `anyUnknownInErrorContext`
- `serviceNotAsClass`

**Related constraints:**

- `declaration: true` — public exports must not pull in unnameable types (historically `NodeInspectSymbol` from Effect’s `Inspectable` when anonymous `class extends Context.Service` tags were exported without explicit surface types).

---

## Goal

1. Set **`anyUnknownInErrorContext`** and **`serviceNotAsClass`** back to **`"error"`** in `tsconfig.json` → `plugins[0].diagnosticSeverity`.
2. Keep **`pnpm run typecheck`** (tsgo) and **`pnpm test`** green.
3. Avoid regressions on **declaration emit** for published symbols (`QueueResource`, `HttpApiResource`, `Resource`, examples that re-export queue tags, etc.).

Optional later pass: promote any remaining `"warning"` severities (e.g. `effectDoNotation`) to `"error"` once style is agreed.

---

## 1. `anyUnknownInErrorContext` — `ProcessGroup`

### Problem

`makeProcessGroup` types the `queues` tuple as an array of **`Context.Key<any, QueueRef<any, any, any, any>>`**. The **`any`** on the key’s identifier parameter flows into `queueInstance` (`tag.asEffect()`), so the composed `Effect`’s requirement channel can trigger **`anyUnknownInErrorContext`** when the rule is on.

Relevant symbols: `makeProcessGroup`, `queueInstance`, `TagIdentifier`, `QueueRef` (`src/ProcessGroup.ts`, `src/QueueResource.ts`).

### Strategies

| # | Approach | Notes |
| - | -------- | ----- |
| A | **Typed queue key** exported from `QueueResource` (or a small `types` module) so `Queues` is `readonly SomeStableQueueKey[]` with **no `Key<any, …>`**. | Preferred if tuple inference for `[Q1, Q2]` survives. |
| B | **API change** — `Record` of tags, builder returning a typed tuple, etc. | Clearer for TS; breaks or extends call sites; update docs + examples + tests. |
| C | **Internal helper** with a sound boundary that does not leak `any` into public `R`. | Easy to get wrong; validate with the plugin on. |

### Acceptance

- Rule on; `makeProcessGroup` return type still reflects real queue requirements (union of identifiers / services as intended).
- Regression: two queues with different `R` still compose correctly in group typings.

---

## 2. `serviceNotAsClass` — `RunResource`

### Problem

`RunResource` uses **`Context.Service<…>(name)`** assigned to a `const` (factory tags). The language service expects **class declaration** shape for `Context.Service` in those positions.

### Strategies

| # | Approach | Notes |
| - | -------- | ----- |
| A | **Class-shaped tags** inside factories (`class Tag extends Context.Service<…>()(name) {}`). | Satisfies the rule; pair with explicit public types (B) to avoid declaration issues. |
| B | **Explicit exported return types** on `make` / `makeRunner` so `.d.ts` only references stable `Context.Service<…>` / `Layer` types, not anonymous class instances. | Required if using classes for tags. |
| C | **Upstream / team guidance** — if Effect documents an exception or preferred factory pattern, align with it. | Long-term ecosystem alignment. |

### Acceptance

- Rule on; no new public exports that rely on anonymous class types without a named public type alias.

---

## 3. Declaration emit — `QueueResource` / `HttpApiResource`

### Current stable approach

Variable **`Context.Service<Shape>(id)`** tags avoid **`NodeInspectSymbol`** leaks in declaration files compared to **anonymous** `class extends Context.Service` without explicit wrapping types.

### When re-enabling `serviceNotAsClass` with class-based tags

Reintroduce classes only with **explicit public return types** (same as RunResource §2B) so consumers and `dist/*.d.ts` stay clean.

### Acceptance

- No TS4023 / TS4058 (or equivalent) on exported queue / HTTP API resource factories and umbrella `Resource` exports.

---

## 4. Suggested execution order

1. **ProcessGroup** — fix `Queues` typing and `queueInstance` path; flip **`anyUnknownInErrorContext`** → `"error"`; typecheck + tests.
2. **RunResource** — class + explicit public types (or approved alternative); flip **`serviceNotAsClass`** → `"error"`; typecheck + tests; confirm `QueueResource` / `HttpApiResource` still emit cleanly (adjust return types if those factories move to classes).
3. Optional: tighten remaining plugin severities and fix call-site style.

---

## 5. Definition of done

- Both rules **`"error"`** in `tsconfig.json`.
- `pnpm run typecheck` and `pnpm test` pass.
- No declaration regressions on published API surface.
- **Changeset** before release if user-facing behavior or types change in a semver-meaningful way.
