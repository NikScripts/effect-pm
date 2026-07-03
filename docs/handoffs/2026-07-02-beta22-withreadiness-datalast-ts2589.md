# beta.22 consumer regression: data-last `withReadiness` trips TS2589

**Consumer:** wow-sports services-hub, upgrading beta.21 → beta.22 (service-shape redesign). The
`query → effect` rename was a clean 2-line change. But the nesting-aware `ServiceOf` deepened one consumer
pattern enough to hit **TS2589 "Type instantiation is excessively deep and possibly infinite."**

## Repro (the pattern that breaks)

Six per-league resource tags, each a **data-last** `.pipe(Resource.withReadiness(fn))` where `fn` is a
**standalone** readiness function:

```ts
export const databaseReadiness = (
  db: Resource.ServiceOf<typeof databaseSpec>,
): Effect.Effect<Resource.Readiness> =>
  Effect.map(db.status, (s) =>
    s.connected
      ? { ready: true, detail: `${s.latencyMs}ms` }
      : { ready: false },
  );

export class WnbaDatabase extends Resource.Tag<WnbaDatabase>()(
  "@app/wnba/Database",
  databaseSpec,
  { host: WnbaHost },
).pipe(Resource.withReadiness(databaseReadiness)) {} // ← TS2589
```

On beta.21 this compiled clean. On beta.22 it trips TS2589. It's **cumulative** — with six such sites in
one program, TS reports the error at whichever site exhausts the depth budget (for us the 6th), so it reads
as "only ebwsl" but converting one site just moves it to the next.

## What fixed it (consumer side)

Switching to the **data-first** form — the one effect-pm's own `ScheduledProcess` Tag def and the redesign
tests use — is shallower and clears all six:

```ts
export class WnbaDatabase extends Resource.withReadiness(
  Resource.Tag<WnbaDatabase>()("@app/wnba/Database", databaseSpec, {
    host: WnbaHost,
  }),
  databaseReadiness,
) {}
```

Also helped keep it shallow: typing the readiness param by the **minimal structural shape** it reads
(`{ readonly status: Effect.Effect<DbStatus> }`) instead of `Resource.ServiceOf<typeof databaseSpec>` — one
fewer deep `ServiceOf` instantiation per site. (This aligns with the earlier finding that the tag already
carries the spec, so `ServiceOf<typeof spec>` in consumer code is redundant.)

## Ask

- The redesign notes already flag TS2589 at two **internal** boundaries (buildPeerClient, clientLayer) and
  break them with `as unknown as`. This one is **consumer-facing** and the tests didn't catch it because
  they use the data-first form. Worth either (a) a redesign test that exercises **data-last**
  `.pipe(withReadiness(fn))` across a few sites, or (b) reducing the data-last overload's instantiation
  depth so both forms are equivalent (data-last is the more ergonomic one for `class X extends …`).
- If data-last is expected to stay heavier, a one-line note in the migration guide ("prefer
  `Resource.withReadiness(tag, fn)` over `.pipe(...)` for resource tags") would save consumers the dig.

Nothing blocking — the data-first swap is clean and we're green on beta.22 (typecheck 0, tests, serves boot
`/health` 10/10). Flagging so the next consumer doesn't have to diagnose it.
