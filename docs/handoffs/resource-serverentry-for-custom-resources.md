# Report: `Resource.serverEntry` for raw custom resources — ergonomics + type-safety (not a block)

**TL;DR.** A raw `Resource.Tag` (custom `query`/`stream`/`mutate` spec) **can already be served** on a
host's `serveAllHttp` — by passing a plain `{ tag, impl }` `ServeEntry` literal. It is **not blocked.**
But the path is a **trap**: the obvious reach, `Resource.instance(tag, impl)` (the parallel to
`Resource.layer`), returns a `ResourceInstance` for `serveInstances` — _not_ a `ServeEntry` — and
`serveAllHttp` rejects it with a misleading error. The working literal also **loses impl
type-checking** (it's typed `Record<string, unknown>`, not `WireServiceOf<S>`) and **erases the
requirement `R`**. Proposal: add a thin, type-safe `Resource.serverEntry(tag, impl)` parallel to the
contract ones (`QueueResource` / `ScheduledProcess` / `ApiMetrics`).

> History: this started life as a "blocked — can't serve custom resources" handoff. That conclusion
> was **wrong** — I'd used `Resource.instance` instead of the `{ tag, impl }` literal. Corrected to a
> DX/safety report. The point still matters: the same wrong turn will catch the next person.

## What actually works (verified)

```ts
class Database extends Resource.Tag<Database>()(
  "@app/Database",
  { status: Resource.query(DbStatus) },
  { host: NwslHost },
) {}

Resource.serveAllHttp([
  QueueResource.serverEntry(RosterQueue, { effect }),
  { tag: Database, impl: { status: pingStatus } }, // ✅ plain ServeEntry literal — compiles + serves
]);
Resource.client(Database); // ✅ reads it over the host transport
```

Type-probed against the published dist from a consumer (host-bound custom tag, mixed with a queue
`serverEntry`): clean. Runtime is sound too — `serveAllHttp`'s `buildImpl` lifts a non-`Effect` impl
with `Effect.succeed`, then maps each member to a handler (`typeof member === "function" ?
member(payload) : member`), so a `query` Effect / `mutate` function / `stream` all dispatch correctly
(`src/Resource.ts:1370`). The `ServeEntry.impl` type explicitly allows it (`src/Resource.ts:1318`):

```ts
readonly impl:
  | Record<string, unknown>                                  // plain resource (this path)
  | Effect.Effect<Record<string, unknown>, never, R>;        // toolkit form (contract serverEntries)
```

## The trap (why I — and others will — conclude "blocked")

`Resource.layer(tag, impl)` is how you provide a custom resource locally, so for _serving_ the hand
reaches for the sibling `Resource.instance(tag, impl)`. It compiles, but it's the wrong tool — it's
for the `serveInstances` family — and dropping it into `serveAllHttp` gives:

```ts
Resource.serveAllHttp([Resource.instance(Database, { status: pingStatus })]);
// ❌ Property 'tag' is missing in type 'ResourceInstance<Spec>' but required in type 'ServeEntry<never>'.
```

Nothing signposts the `{ tag, impl }` literal: it appears only inside the `serveAllHttp` JSDoc example
(`src/Resource.ts:1330`), not from `instance`, not in `RESOURCE-API.md`. Every other resource kind has
a named `serverEntry` (`QueueResource.serverEntry`, `ScheduledProcess.serverEntry`,
`ApiMetrics.serverEntry`); the raw `Resource` is the one that makes you hand-write the object literal —
so the natural assumption is "there's no way," not "write the literal the contracts' helpers return."

## The two real gaps in the literal path

1. **Impl is not spec-checked.** `ServeEntry.impl` is `Record<string, unknown>`, so
   `{ tag: Database, impl: { sttaus: pingStatus } }` (typo, missing `status`) **compiles**. The
   contract `serverEntry`s don't have this hole — they build the impl from a typed config, so the
   method set is checked. Raw resources lose `WireServiceOf<S>` checking exactly where a hand-written
   impl most needs it.
2. **Requirement `R` is erased.** The literal fixes the entry at `ServeEntry<never>`, so if an impl
   method carries a requirement (the way `ApiMetrics.serverEntry` returns `ServeEntry<Scope>`), it
   isn't surfaced into `serveAllHttp`'s `R` and won't be demanded from the serve context → a runtime
   missing-service instead of a compile error.

## Proposal

A thin, typed `serverEntry` on `Resource`, mirroring the contracts:

```ts
export const serverEntry = <Self, S extends Spec, R = never>(
  tag: ResourceTag<Self, S>,
  impl: WireServiceOf<S>, // R surfaced from the impl's method requirements
): ServeEntry<R> => ({ tag, impl });
```

Implementation is essentially the body above — `serveAllHttp` already lifts a plain record, so this is
mostly types: restore `WireServiceOf<S>` checking and thread `R`. Payoff: symmetry with the other
contracts, a spec-checked impl, preserved worker requirements, and discoverability so nobody burns an
afternoon on `Resource.instance` + a "can't be done" revert (I did).

Cheap adjacent wins, independent of the above:

- One line in `RESOURCE-API.md` / the `instance` JSDoc: "to serve a custom resource on a shared host,
  use `Resource.serverEntry(tag, impl)` / a `{ tag, impl }` entry in `serveAllHttp` — `instance` is for
  the `serveInstances` family."
- Optionally widen `serveAllHttp` to also accept a `ResourceInstance` (it already carries tag + impl),
  so the natural-but-wrong reach just works.

## Why it matters (consumer)

wow-sports models operational deps as **monitorable resources** — `Database` (connection + ping
latency), `Import` (flush backlog/errors + control), `EventManager` — each a custom `Resource.Tag`
served on its league host so the dashboard shows a card and, via **dependency-aware readiness**
(`Resource.readinessOf`, shipped), queues report degraded when the DB is down. With the finding above
this is **unblocked today** via `{ tag, impl }`; `Resource.serverEntry` makes it type-safe and obvious.
See `apps/services-hub/docs/MONITORABLE-RESOURCES-PLAN.md` in the consumer repo.

## Evidence / source

- `src/Resource.ts:1306` `ServeEntry` (impl: `Record | Effect<Record,never,R>`).
- `src/Resource.ts:1330` `serveAllHttp` JSDoc — the `{ tag, impl }` literal example (the only signpost).
- `src/Resource.ts:1370` `buildImpl` — lifts a non-Effect impl via `Effect.succeed`.
- `src/Resource.ts:614` `WireServiceOf<S>` — the spec-checked impl shape the literal path skips.
- `src/ScheduledProcess.ts:593`, `src/ApiMetrics.ts:200` — the precedent `serverEntry`s (`{ tag, impl }`).

## Related

- `serve-apimetrics-with-group.md` — the shipped `ApiMetrics.serverEntry` (closest precedent).
- `resource-host-health.md` — `/health` + per-resource readiness (shipped).
