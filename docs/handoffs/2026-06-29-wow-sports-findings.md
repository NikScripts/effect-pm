# Findings index — wow-sports services-hub integration (2026-06-29)

Issues surfaced while building the per-league **monitorable `Database` resource** (custom
`Resource.Tag` served on each league host, readiness → `/health`) on vendored `0.8.0-beta.13`.
Ordered by impact. Each links a detailed handoff.

| #   | Issue                                                                        | Severity     | Status for the consumer                                  |
| --- | ---------------------------------------------------------------------------- | ------------ | -------------------------------------------------------- |
| 1   | Host-bound `withReadiness` fix not on `main`                                 | 🔴 blocker   | Blocked readiness→`/health`; shipped the card without it |
| 2   | `withReadiness` **data-first** overload omits `HostBoundTag`                 | 🔴 blocker   | Same; even the branch fix is partial                     |
| 3   | Root cause: `HostBoundTag` ⊄ `ResourceTag<any,any>` (invariant `[groupSym]`) | 🟠           | Per-helper band-aids; latent in every helper             |
| 4   | No `Resource.serverEntry` for raw resources                                  | 🟡 DX/safety | Worked around with `{ tag, impl }`; impl unchecked       |
| 5   | `serveAllHttp` pins one `R` across entries                                   | 🟡 DX        | `as ServeEntry<never>` on every ApiMetrics entry         |

## Details

- **#1, #2, #3** → [`withreadiness-host-bound-tags.md`](./withreadiness-host-bound-tags.md)
  - #1: the data-last (`.pipe`) fix + regression test are only in `cursor/host-health-dogfood`, not
    `main` — so published/`main` consumers can't attach readiness to any host-bound tag (`TS2684`).
  - #2: even on the branch, the **data-first** `withReadiness(tag, fn)` overload still constrains to
    `ResourceTag<any,any>` (no `| HostBoundTag`) → `TS2345`. Regression test only covers `.pipe`.
  - #3: `HostBoundTag extends ResourceTag` yet isn't assignable to `ResourceTag<any,any>` (invariant
    `[groupSym]` map / `ServiceClass` variance). Forces a hand-rolled `| HostBoundTag` per helper
    (`clientLayer` already has one). A structural fix would retire the whack-a-mole.
- **#4** → [`resource-serverentry-for-custom-resources.md`](./resource-serverentry-for-custom-resources.md)
  (the corrected report — custom resources _are_ servable via `{ tag, impl }`; the ask is a typed,
  discoverable `Resource.serverEntry`; `Resource.instance` is a trap).
- **#5** → [`serveallhttp-heterogeneous-requirements.md`](./serveallhttp-heterogeneous-requirements.md)
  (`serveAllHttp` should union each entry's `R` instead of constraining all to one).

## What unblocks the most for one fix

**#1 + #2** — merge the host-bound `withReadiness` support to `main` _and_ extend it to the data-first
overload (+ a data-first regression case). That alone lets wow-sports turn the `TODO(#29)` in each
`<League>Database` tag into a one-line `.pipe(Resource.withReadiness(databaseReadiness))` and make the
host `/health` go `503` when Postgres drops. #3 is the durable root-cause version of #1/#2.
