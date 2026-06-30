# Report: `serveAllHttp` pins one `R` across entries → mixed-requirement entries need casts

`serveAllHttp` serves entries whose impls carry **different** requirement channels (a queue's worker
`R`, an `ApiMetrics` entry's `Scope`, a plain resource's `never`). Its signature collapses them to a
single `R`, so TS picks one and rejects the rest — the author has to cast.

```ts
const serveAllHttp = <R = never>(
  entries: ReadonlyArray<ServeEntry<R>>,            // ← one R for the whole array
  options?: { … },
): Layer.Layer<never, never, R | HttpServer.HttpServer> => …
```

## The wall (real consumer)

A per-league host serves queues + processes (worker requirement `R = …WorkerRequirements`) **and**
`ApiMetrics.serverEntry(tag)` (which returns `ServeEntry<Scope.Scope>`):

```ts
Resource.serveAllHttp([
  QueueResource.serverEntry(RosterQueue, { effect }),     // ServeEntry<RosterWorkerRequirements>
  ScheduledProcess.serverEntry(LiveScore, { … }),         // ServeEntry<…>
  ApiMetrics.serverEntry(SdpApi),                          // ServeEntry<Scope>
])
// ❌ TS2322: Type 'ServeEntry<Scope>' is not assignable to type
//    'ServeEntry<NwslRosterImportWorkerRequirements>'.
```

TS unifies `R` to the queue's worker requirements (the dominant/first), and `ServeEntry<Scope>`
doesn't fit. Worked around by widening every ApiMetrics entry:

```ts
ApiMetrics.serverEntry(SdpApi) as ServeEntry<never>,
```

`never` is assignable to any `R`, so the cast slots in — but it **erases `Scope` from the entry's
type**, which only happens to be safe because the serve entry runs under an ambient `Effect.scoped`.
A plain `{ tag, impl }` resource (`R = never`) avoids the cast by accident; anything with a real,
_different_ `R` hits it.

## What we want

`serveAllHttp` should accept heterogeneous entries and **union** their requirements, the way
`Layer.mergeAll` / `Effect.all` do — no per-entry cast:

```ts
// sketch: union R across a tuple of entries
declare const serveAllHttp: <const Entries extends ReadonlyArray<ServeEntry<any>>>(
  entries: Entries,
  options?: { … },
) => Layer.Layer<
  never,
  never,
  | (Entries[number] extends ServeEntry<infer R> ? R : never)
  | HttpServer.HttpServer
>;
```

i.e. infer each entry's `R` and union them into the result requirement, instead of constraining all
entries to one `ServeEntry<R>`. The runtime already builds each impl independently
(`buildImpl` per entry), so this is a signature change — the value side already does the right thing.

## Why it matters

It's the normal case, not an edge: any host that serves an instrumented client (ApiMetrics, `Scope`)
next to queues/processes (worker `R`) hits it. The cast is easy to get subtly wrong (you're erasing a
real requirement and trusting it's provided ambiently). Unioning `R` makes the requirement honest and
removes the boilerplate — wow-sports currently carries `as ServeEntry<never>` on every ApiMetrics
entry across three league serves.

## Evidence

- `src/Resource.ts` `serveAllHttp = <R = never>(entries: ReadonlyArray<ServeEntry<R>>, …)`.
- `src/ApiMetrics.ts` `serverEntry(...): ServeEntry<Scope.Scope>`.
- Consumer: `apps/services-hub/src/layers/{nwsl,ebwsl,wnba}-serve.ts` — `as ServeEntry<never>` on each
  `ApiMetrics.serverEntry(...)`.

## Related

- `resource-serverentry-for-custom-resources.md` — the `{ tag, impl }` literal that dodges this only
  because it's `R = never`.
