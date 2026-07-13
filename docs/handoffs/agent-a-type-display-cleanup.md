# Type-display cleanup — continue and land

**For:** the engineer continuing the resource-handle type-display work.
**Owner protocol:** engine changes land on an engine branch (off `integration/storage`), plan-first, show Before/After per change, nothing merges without an explicit go. Never sit on an integration branch.

## Why this exists

`yield* SomeResource.Tag` used to hover as an unreadable wall — each member shown as its raw spec
descriptor, e.g. `add: Method<"mutate", Schema.Union<[Schema.Struct<{ to: Schema.String }>, …]>, …>`,
times ~18 members. The goal: the handle should read as its **service shape** — real methods and what
they return — not spec descriptors, and not a name that hides the members (a named-façade interface was
tried and **rejected**: it hides the shape).

## What is shipped (uncommitted, in the working tree on the docs branch)

All in `src/Resource.ts`. Cast-free. Gate green: `typecheck 0 / lint 0 / test 456`, effect-language-service clean.

1. **`Simplify` on `ServiceOf`** (the mapped type at ~`:1237`, wrapped `Simplify<{ … }>`; import
   `import type { Simplify } from "effect/Types"`). `ServiceOf` is the tag's service type. As a bare
   mapped-type alias TS printed `ServiceOf<theSpec>` and expanded the **spec argument** (the `Method<…>`
   wall) without applying the map. `Simplify` forces evaluation, so the hover shows the **resolved
   service**: `add: (payload) => Effect<void, never, never>`, `size: Subscribable<number>`, etc.

2. **`PrettifyPayload` / `PrettyObject`** (just above `PayloadOf` at ~`:1175`; `PayloadOf`'s two branches
   now wrap their result in `PrettifyPayload<…>`). The schema's decoded `.Type` prints as an unresolved
   alias — `Schema.Struct.ReadonlySide<{ readonly to: Schema.String }, "Type">` instead of `{ to: string }`.
   `PrettyObject<T> = T extends object ? { -readonly [K in keyof T]: T[K] } : T` forces the alias to its
   plain object **and drops the schema-imposed `readonly`** (the payload is a value you pass in). Applied
   per union-member (enqueue verbs take `item | item[]`): genuine arrays keep their element prettified; a
   **tuple** (pair call-style payload — `length` is a literal, not `number`) is left untouched so pair
   detection still matches; non-objects (bare-`string` payloads) pass through. It is **shallow on purpose**
   (see the limit below) and **assignment-preserving**, so callers are unaffected.

   Result: `add`/`prioritize`/`defer` now read `(payload: { to: string } | readonly { to: string }[]) => Effect<void, never, never>`.

## The known limit — nested `item` (do NOT re-attempt the blanket deep fix)

The entry-carrying verbs (`enqueue`/`release`/`deadLetter`/`drop`) take a `QueueEntry`, whose nested
`item:` field still shows `Schema.Struct.ReadonlySide<…>`. A **deep** recursive prettify (`DeepPretty`,
recursing through string-keyed objects, stopping at symbol-branded types like `DateTime.Utc`) **does**
clean the display — but it breaks the build: `src/CustomQueueResource.ts:537-542`,
`DeepPretty<View<…>>` is not assignable to the expected `QueueEntry<View<…>>`. Reason: `PayloadOf` /
the entry types are consumed there as a **real value contract**, not just for display, so any deep
structural rewrite diverges from what `QueueEntry` expects.

**The fix must be targeted, not a shared deep transform.** Two viable routes:
- (a) Resolve `item` at the **`QueueEntry` schema-type** definition (where the entry type is built from
  `itemSchema` — see `queueEntry` / `queueEncodedEntry` in `src/QueueResource.ts`), so the clean type is
  the contract everywhere, or
- (b) split display from contract: apply a prettify **only on the service-method rendering path**
  (`ServiceMethod`), leaving the shared `PayloadOf` that `CustomQueueResource` consumes untouched.

Route (b) is lower-risk. Whatever you pick, the acceptance bar is: nested `item` reads `{ to: string }`,
`DateTime.Utc` stays `DateTime.Utc` (not expanded into internals), and `typecheck + test` stay green.

## The broader backlog ("a lot of other types")

Same treatment, resource by resource — apply the shallow-safe pattern, verify each doesn't break
assignability:
- **`Process` / `RunResource` / `ApiMetrics` / `NodeStatus`** handles — `yield* Tag` on each still shows
  the `Method<…>` wall for its own spec. `Simplify` on `ServiceOf` already helps all of them; confirm and
  clean any per-resource payload aliases.
- Sweep public types for verbose `Schema.*` aliases in hovers (status/metrics/entry structs, config
  objects). Prefer the shallow, assignment-preserving `PrettyObject` shape; escalate to a targeted
  schema-type fix only where a shared contract (like the entry) forbids the blanket transform.

## How to verify a hover — the caching gotchas that cost this session hours

The editor resolves `@nikscripts/effect-pm/*` through `package.json` `exports` to **`dist/*.d.ts`**, NOT
`src`. Consequences:
- After **every** `src` change you must **`pnpm build`** *and* **restart the TS server** (or the IDE shows
  stale types). There is a stale copy of the package at `short-box/node_modules/@nikscripts/effect-pm`
  (Oct 2025, legacy API) and a second checkout at `effect-pm-alt` — make sure you're reading *this* dist.
- To measure a hover headless (no editor), use the TS compiler-API probe resolving to dist:
  ```
  paths: { "@nikscripts/effect-pm": ["dist/index.d.ts"], "@nikscripts/effect-pm/*": ["dist/*.d.ts"] }
  → checker.typeToString(getTypeAtLocation(<the `const x = yield* Tag` name>), …, NoTruncation)
  ```
- The **docs** twoslash (`docs/site/src/lib/highlight.ts`) resolves to **`src`** via its own compiler
  `paths`, but the running dev server's twoslash language-service **caches per-process** — restart 5190
  to refresh it. The dev server also sends **no cache headers**, so the browser serves stale HTML on a
  plain reload — load `http://<host>:5190/?v=N` or a private tab to bypass.
- **Optional DX fix that ends the loop:** add repo tsconfig `paths` → `src`
  (`"@nikscripts/effect-pm/*": ["./src/*"]`), so in-repo files read source live — no rebuild, no restart.
  Doesn't affect the published build (tsup bundles from src regardless). Not yet applied; owner's call.

## Landing

`src/Resource.ts` is **engine** code — it belongs on an engine branch cut from `origin/integration/storage`,
not the docs branch it currently sits on. The docs-side additions (copy button, line numbers — see
`docs/site/src/islands/CopyButton.tsx`, `docs-content.tsx`, `docs.css`) are docs-branch work. Keep the two
apart at commit time; they're coupled only in that the docs twoslash *displays* the engine's types.
