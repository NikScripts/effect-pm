# Branch cleanup manifest — 2026-07-09

**Audit baseline:** `origin/integration/storage` @ `62908569be3b46efa7f8b483eab14fea9870e35a`  
**Agent:** Agent 02 (remote branch hygiene)  
**Branch:** `cursor/branch-cleanup-a009`

## Audit method

For each `origin/cursor/*` branch:

- **merged** = `git merge-base --is-ancestor origin/<branch> origin/integration/storage`
- **ahead** = `git rev-list --count origin/integration/storage..origin/<branch>`

**Delete rule:** `merged=yes` **and** `ahead=0`, excluding the locked keep list in
[`agent-02-branch-cleanup.md`](./agent-02-branch-cleanup.md).

## Pre-delete audit (full)

```
cursor/agent-handoffs-a009|merged=no|ahead=1|tip=82f6df6|docs(handoffs): assign branch cleanup and Process close-out agents
cursor/beta-18-dependency-serve|merged=yes|ahead=0|tip=9410293|docs(handoffs): note back to wow-sports — per-resource dependencies resolved
cursor/config-object-tags-a009|merged=yes|ahead=0|tip=1524a32|breaking(toolkit): config-object-only Tag wire schemas
cursor/custom-queue-store-wiring-a009|merged=yes|ahead=0|tip=2e12eb8|feat(CustomQueueResource): wire shared queue store engine
cursor/effect-beta-upgrade|merged=yes|ahead=0|tip=26c7c41|chore(deps): upgrade Effect to 4.0.0-beta.92 (from beta.69)
cursor/fix-store-effects-provide-a009|merged=yes|ahead=0|tip=b087dfc|fix(store): stop per-write Effect.provide on store effects
cursor/host-health-dogfood|merged=no|ahead=1|tip=a8da2c9|docs(handoffs): lock the multi-host-instances design decisions
cursor/integration-result-schema-a3ad|merged=yes|ahead=0|tip=8414fb9|docs(store): teach Store.extend tiers + Resource.provideContext; queue is the golden model for both
cursor/log-storage|merged=yes|ahead=0|tip=2a02949|release: 0.8.0-beta.17 (durable log storage + multi-host consumer ergonomics)
cursor/multi-host-instances|merged=yes|ahead=0|tip=377e120|release: 0.8.0-beta.16 (multi-host peers + Effect beta.92)
cursor/process-store-cutover-a3ad|merged=yes|ahead=0|tip=40d8422|refactor(process): Store.extend tiers + Resource.provideContext
cursor/process-tag-schemas-a3ad|merged=yes|ahead=0|tip=00227c2|feat(Process): positional result/error schemas on Tag + queue-aligned store contract
cursor/queue-golden-cleanup|merged=yes|ahead=0|tip=b1b0af5|refactor(queue): DRY buildQueueImpl — verb type aliases + history helpers, no behavior change
cursor/resource-tooling|merged=yes|ahead=0|tip=4dcb09e|Merge remote-tracking branch 'origin/rewrite/resource-toolkit' into cursor/resource-tooling
cursor/resource-ui|merged=yes|ahead=0|tip=3e8082e|release: 0.8.0-beta.13
cursor/result-schema-rpc-handoff-a3ad|merged=no|ahead=2|tip=ac66f01|docs: revise handoff — positional result/error schemas, no pipe API
cursor/run-resource-handle-observable-a009|merged=yes|ahead=0|tip=0ead238|docs(RunResource): close criticism audit — baked-default policy sync
cursor/run-resource-hardening-a009|merged=yes|ahead=0|tip=31179a4|merge: sync integration tip — Process store cutover + unified facet removal
cursor/run-resource-persistence-upgrade-a009|merged=yes|ahead=0|tip=b087dfc|fix(store): stop per-write Effect.provide on store effects
cursor/store-and-logs-design|merged=yes|ahead=0|tip=76ae5cb|Add shape-first Store contract API with readable handle types.
cursor/store-cutover-closeout-ce05|merged=no|ahead=3|tip=326650b|docs(store): Phase 2 integration-sync and queue report truth sweep
cursor/store-extend-tier-refactor-a009|merged=yes|ahead=0|tip=727aac0|refactor(run-resource): inline fact.append; docs + conformance tests
```

## Deleted (18)

All passed `merged=yes` and `ahead=0` at audit time. Removed with `git push origin --delete cursor/<name>`.

| Branch | Last commit | Summary |
|--------|-------------|---------|
| `cursor/beta-18-dependency-serve` | `9410293` | docs(handoffs): note back to wow-sports — per-resource dependencies resolved |
| `cursor/config-object-tags-a009` | `1524a32` | breaking(toolkit): config-object-only Tag wire schemas |
| `cursor/custom-queue-store-wiring-a009` | `2e12eb8` | feat(CustomQueueResource): wire shared queue store engine |
| `cursor/effect-beta-upgrade` | `26c7c41` | chore(deps): upgrade Effect to 4.0.0-beta.92 (from beta.69) |
| `cursor/fix-store-effects-provide-a009` | `b087dfc` | fix(store): stop per-write Effect.provide on store effects |
| `cursor/integration-result-schema-a3ad` | `8414fb9` | docs(store): teach Store.extend tiers + Resource.provideContext; queue is the golden model for both |
| `cursor/log-storage` | `2a02949` | release: 0.8.0-beta.17 (durable log storage + multi-host consumer ergonomics) |
| `cursor/multi-host-instances` | `377e120` | release: 0.8.0-beta.16 (multi-host peers + Effect beta.92) |
| `cursor/process-store-cutover-a3ad` | `40d8422` | refactor(process): Store.extend tiers + Resource.provideContext |
| `cursor/process-tag-schemas-a3ad` | `00227c2` | feat(Process): positional result/error schemas on Tag + queue-aligned store contract |
| `cursor/queue-golden-cleanup` | `b1b0af5` | refactor(queue): DRY buildQueueImpl — verb type aliases + history helpers, no behavior change |
| `cursor/resource-tooling` | `4dcb09e` | Merge remote-tracking branch 'origin/rewrite/resource-toolkit' into cursor/resource-tooling |
| `cursor/resource-ui` | `3e8082e` | release: 0.8.0-beta.13 |
| `cursor/run-resource-handle-observable-a009` | `0ead238` | docs(RunResource): close criticism audit — baked-default policy sync |
| `cursor/run-resource-hardening-a009` | `31179a4` | merge: sync integration tip — Process store cutover + unified facet removal |
| `cursor/run-resource-persistence-upgrade-a009` | `b087dfc` | fix(store): stop per-write Effect.provide on store effects |
| `cursor/store-and-logs-design` | `76ae5cb` | Add shape-first Store contract API with readable handle types. |
| `cursor/store-extend-tier-refactor-a009` | `727aac0` | refactor(run-resource): inline fact.append; docs + conformance tests |

## Kept (4)

| Branch | Ahead of `integration/storage` | Reason |
|--------|--------------------------------|--------|
| `cursor/store-cutover-closeout-ce05` | 3 | Open PR — CQR `BuiltResource` + handoff sweep (locked keep list) |
| `cursor/result-schema-rpc-handoff-a3ad` | 2 | Unmerged docs handoffs for RPC validation (locked keep list) |
| `cursor/host-health-dogfood` | 1 | Active dogfood work (locked keep list) |
| `cursor/agent-handoffs-a009` | 1 | Agent assignment handoffs not yet merged into `integration/storage` |

## Skipped

None — every branch that failed the delete rule (`merged=no` or `ahead>0`) is listed under **Kept**.

## Post-cleanup verification

After deletes, `git branch -r | grep cursor/` shows only the four kept branches above.
