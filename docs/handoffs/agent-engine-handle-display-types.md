# Engine — clean display type for resource handles

**Scope:** `src/Resource.ts` (+ `src/QueueResource.ts`, `src/Process.ts`, `src/ApiMetrics.ts`). Engine branch, **not** the docs branch.
**Owner protocol:** plan first, show Before/After per change, nothing lands without a go.

## Problem

`yield* SomeTag` hovers as a wall, everywhere it's shown — editors, the docs twoslash popovers, the dashboard types:

```
const emails: ServiceOf<{
    add: Method<"mutate", Schema.Union<readonly [Schema.Struct<{ readonly to: Schema.String; }>, …]>, Schema.Void, Schema.Never, false, MethodAnnotations & { description: string; }>;
    prioritize: Method<…>;
    … 16 more …;
    logs: { … };
}, Emails>
```

That's not readable. We want `const emails: QueueHandle<EmailJob>` (a name).

## Root cause

`ResourceTag<Self, S>` bakes the service type as `ServiceOf<S, Self>` (`Resource.ts:1576`), and `ServiceOf` (`:1236`) is a **generic type alias of a mapped type**. TS expands the **spec argument** (`QueueInstanceSpec<F>` → the `{ add: Method<…> }` literal) in every hover. Since it's an alias, not a nominal type, there's no name to show instead.

## What was measured (don't repeat these)

- **`Simplify<ServiceOf<…>>`** (from `effect/Types`): resolves the mapped type to the real service object — `{ readonly add: (payload: Schema.Struct.ReadonlySide<…>) => Effect<void, never, never>; … }`. More *informative* (real method signatures) but **not cleaner** — 653 chars vs 538, still a member wall, still no name. Not the fix.
- **`@effect/language-service` quickinfo** (patched TS + plugin in the twoslash compilerOptions): **no change** to this hover — the patch targets `tsc`, not twoslash's bare `createLanguageService`, and the LSP's quickinfo is targeted at `yield*`/`Layer`/`Effect`, not a general structural simplifier.

## The fix — a named façade

Give the handle a **nominal** type so TS prints the name instead of expanding:

1. Add an optional third type param to the tag, defaulted so nothing else changes:
   ```ts
   export interface ResourceTag<Self, S extends Spec, Svc = ServiceOf<S, Self>>
     extends Context.ServiceClass<Self, string, Svc> { … }
   ```
2. Define an **empty interface** per resource kind that extends `ServiceOf` (empty interfaces display by name, not expanded):
   ```ts
   export interface QueueHandle<F extends Schema.Struct.Fields, Self = unknown>
     extends ServiceOf<QueueInstanceSpec<F>, Self> {}
   ```
3. Point each contract Tag factory's return type at its handle: `QueueResource.Tag` → `ResourceTag<Self, QueueInstanceSpec<F>, QueueHandle<F, Self>>` (same for `Process` / `ApiMetrics`). `QueueHandle` **extends** `ServiceOf<…>`, so it stays assignable wherever a plain `ResourceTag<Self, S>` (default `Svc`) is expected — no casts.

**Blast radius / risk:** `ResourceTag` is used across `layer`/`serve`/`client`/`peersLayer`/etc. The third param is defaulted so 2-arg usages are unchanged; the risk is service-type variance where a `Svc`-narrowed tag is passed to a `ServiceOf<S>`-expecting slot. Validate with full `typecheck` + `test`. **No `as` casts** (the interface-extends approach is cast-free by construction).

## Acceptance

- `yield* Emails` hovers as `QueueHandle<EmailJob>` (name), same for `Process`/`Api`.
- `pnpm typecheck && lint && test && build` green; effect-language-service clean.
- Benefits editors, the dashboard `src/web` types, and the docs twoslash popovers at once.

## Why now

The docs intro is fully twoslash'd (`docs/twoslash-hover-types`), and scalar/`Effect`/schema hovers are already clean and real. The **only** remaining ugliness is the resource-handle hover — this fix removes it, and we can then strip the friendly-comment fallback the intro currently keeps on handle lines.
