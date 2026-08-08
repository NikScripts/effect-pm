{#update title="Update" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/update>.
<!-- docs-site-link:end -->
# Update — plan, simulate, execute

Fleet cutover as an **inspectable plan**, then a dumb executor. Separate from
[`Versioned`](/docs/versioned) (schema chains) and from options-bag
`Launcher.restartSuccessor` (still available; prefer `Update` for new code).

```ts
import * as Update from "hyperlink-ts/Update"
import * as Launcher from "hyperlink-ts/Launcher"
import * as Lookup from "hyperlink-ts/Lookup"

const plan = yield* Update.plan({
  steps: [
    // order = strategic handoff sequence
    { target: "fleet/Mail", successor: mailB, tags: [Mail] },
    { target: "fleet/Jobs", successor: jobsB, tags: [Jobs] },
  ],
  contracts: [
    // optional — fail closed when tips don't match
    { tag: Jobs, from: "jobs/payload@2", to: "jobs/payload@3" },
  ],
})

yield* Update.simulate(plan) // validate — no spawn
yield* Update.execute(plan)  // ordered Launcher cutovers (skipPlan)
```

## Who owns what

| Plane | Role |
|-------|------|
| **Update** | Compose plan · contract audit · ordered execute |
| **Lookup.planUpdate** | Per-step impact dry-run (feeds `plan`) |
| **Launcher** | Custody / `up` / `restartSuccessor` (execute uses it) |
| **Versioned** | Schema tips / path checks for `contracts` |
| **Policy / Advice** | Sticky dial + prefer during dual-serve |

## Plan

`Update.plan({ steps, contracts? })` runs `Lookup.planUpdate` for each step **in
array order**, attaches `impact`, audits contracts, and returns an
`Update.Plan` value (`_tag: "UpdatePlan"`).

| Failure | When |
|---------|------|
| `EmptyUpdatePlan` | `steps` is `[]` |
| `EmptyUpdateStepTags` | A step has `tags: []` |
| `DuplicateUpdateTarget` | Two steps share the same `target` |
| `UpdateBlocked` | Hard impact blockers on the **target** (same as planUpdate fail-closed) |
| `UpdateContractMismatch` | Bad `contracts.to` / `from` / Versioned path (carries full `audit`) |
| `UpdateTargetUnknown` | Step `target` missing from Directory |

Ambient `force: true` (plan-level or per-step) collects blocked impacts onto the
plan instead of failing at planUpdate — `plan.blocked` stays `true` and
`simulate` / `execute` still refuse. Use force to **inspect**, not to push a
broken cutover through execute.

Per-step `skipPlan: true` skips impact dry-run (ops escape; impact is
`undefined`). Prefer the fail-closed path in app code.

### Status dial vs fleet order

Hard blockers (`migrationGaps`, `contractDrifts`, `blocked`) are **target-scoped**.
Co-update peers keep old tips until their own step runs — they appear on
`coUpdate` / `liveTips` but do **not** fail-close an earlier step. Dry-run
examples often use `Lookup.planStatusOff` when no live nodes answer status.

### Inspect

| Field | Meaning |
|-------|---------|
| `plan.steps[i].impact` | Per-step `Lookup.planUpdate` result |
| `plan.audit` | Contract from→to rows |
| `plan.coUpdate` | Union of peer nodeKeys sharing served keys |
| `plan.uncoveredCoUpdate` | Peers in `coUpdate` that are not step targets (advisory) |
| `plan.blocked` | Any **target** step impact blocked |

## Simulate

`Update.simulate(plan)` re-validates audit / blocked **without spawning** — a pure
plan-value gate (does not re-dial Directory/status). Fails with
`UpdatePlanBlocked` or `UpdateContractMismatch`.

For a **full production-like mock**: boot Lookup + incumbent nodes the same way
you would in prod (real Http Node / WorkPool / Directory), then
`plan` → `simulate` → `execute`. See `test/update.test.ts` and
`pnpm run example:launcher-dream-redeploy`.

## Execute

`Update.execute(plan)` re-runs the simulate gate, then each step via
`Launcher.restartSuccessor` with `skipPlan: true`. Returns each step's
**planned** impact (execute does not re-run planUpdate). Only step `prefer`
is forwarded to custody.

## Contracts

Optional `contracts: [{ tag, from?, to? }]`:

| Field | Meaning |
|-------|---------|
| `to` | Successor tip must equal `schemaVersion` / Versioned tip of `tag` |
| `from` | Live tip on the **target** (`impact.liveTips` / migration gaps); else with `to`, Versioned path must allow `from→to`; `from` alone with no observation fails closed |

`from` is strongest when status dial is on (`Lookup.planStatusOn` / step
`status: true`). With `planStatusOff`, use `from`+`to` so the Versioned path
check can run.

Audit failure reasons are PascalCase: `From` | `To` | `Path`.

Not required for same-tip binary bumps. Matching contracts land on
`plan.audit` with `ok: true`.

## Migration from `restartSuccessor`

```ts
// before
yield* Launcher.restartSuccessor({
  target,
  successor: { node: nodeB, process },
  tags: [Jobs],
})

// after
const plan = yield* Update.plan({
  steps: [{ target, successor: { node: nodeB, process }, tags: [Jobs] }],
})
yield* Update.simulate(plan)
yield* Update.execute(plan)
```

Multi-node rollouts: put every affected node in `steps` in the order you want
handoffs to run. Check `plan.uncoveredCoUpdate` for peers Directory says share
keys but you did not schedule.

## Examples

| Form | Run |
|------|-----|
| Fleet plan dry-run (`coUpdate` inspect) | `pnpm run example:launcher-update-fleet` |
| Dream redeploy (file-swap + Update) | `pnpm run example:launcher-dream-redeploy` |
| Suite | `pnpm exec vitest run test/update.test.ts` |

Design dock (addresses / Node.make / locality — future):
[`node-addresses-and-update-api.md`](../handoffs/node-addresses-and-update-api.md).
