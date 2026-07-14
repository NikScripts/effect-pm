# Agent 02 — Remote branch cleanup

**Integration branch:** `integration/storage` (audit baseline — **do not branch code from here**)  
**Supervisor:** cloud agent supervisor  
**Agent type:** **Cursor Cloud Agent** — mechanical git hygiene, docs-only output in-repo  
**Independence:** No dependency on Agent 01 (`store-cutover-closeout-ce05`) or Process close-out.

---

## Read first (5 min)

| Doc | Why |
|-----|-----|
| [`integration-sync-2026-07-07.md`](integration-sync-2026-07-07.md) | What landed on `integration/storage` |
| [`reports/README.md`](./reports/README.md) | Active agents and keep-list context |

---

## Goal

Delete **stale remote `cursor/*` branches** whose work is fully merged into `origin/integration/storage`, document what was removed, and publish a **keep list** so future agents do not resurrect deleted branches.

This is **git + docs only**. No application code changes unless you find a one-line typo in a handoff while auditing.

---

## Locked rules (do not violate)

| Rule | Detail |
|------|--------|
| **Never delete active branches** | See keep list below — re-audit before every `git push origin --delete` |
| **Merge target** | `origin/integration/storage` at tip when you start |
| **Ancestor test** | `git merge-base --is-ancestor origin/<branch> origin/integration/storage` **and** `git rev-list --count origin/integration/storage..origin/<branch>` is `0` |
| **No force-push** | `integration/storage`, `main`, or any branch you keep |
| **No changeset** | Docs-only manifest |

---

## Keep list (never delete)

Re-run the audit script before deleting anything. These branches are **not** fully merged or still carry unique commits:

| Branch | Why keep |
|--------|----------|
| `cursor/result-schema-rpc-handoff-a3ad` | Docs handoffs for RPC validation (not merged) |
| `cursor/host-health-dogfood` | Active dogfood work (not merged) |

`cursor/store-cutover-closeout-ce05` and `cursor/branch-cleanup-a009` **merged into `integration/storage` on 2026-07-09** — safe to delete on Phase 2 cleanup.

If a branch is on the keep list but later merges, a future cleanup pass may delete it.

---

## Delete candidates (audit snapshot 2026-07-09)

All below were **`yes 0`** — ancestor of `integration/storage`, zero commits ahead — at handoff time:

```
cursor/beta-18-dependency-serve
cursor/config-object-tags-a009
cursor/custom-queue-store-wiring-a009
cursor/effect-beta-upgrade
cursor/fix-store-effects-provide-a009
cursor/integration-result-schema-a3ad
cursor/log-storage
cursor/multi-host-instances
cursor/process-store-cutover-a3ad
cursor/process-tag-schemas-a3ad
cursor/queue-golden-cleanup
cursor/resource-tooling
cursor/resource-ui
cursor/run-resource-handle-observable-a009
cursor/run-resource-hardening-a009
cursor/run-resource-persistence-upgrade-a009
cursor/store-and-logs-design
cursor/store-extend-tier-refactor-a009
```

**Re-audit before delete.** Integration line may have moved; only delete branches that still pass both checks.

---

## Slices (one session, in order)

### A — Baseline audit

```bash
git fetch origin integration/storage
BASE=origin/integration/storage
for b in $(git branch -r | grep 'origin/cursor/' | sed 's|origin/||'); do
  merged=$(git merge-base --is-ancestor origin/$b $BASE 2>/dev/null && echo yes || echo no)
  ahead=$(git rev-list --count $BASE..origin/$b 2>/dev/null)
  echo "$merged $ahead $b"
done | sort
```

Save output in the manifest (slice B).

### B — Write manifest

Create [`branch-cleanup-manifest.md`](branch-cleanup-manifest.md) with:

1. Audit date + `integration/storage` tip SHA
2. **Deleted** — branch name, last commit SHA, one-line summary (from `git log -1 --oneline`)
3. **Kept** — branch name, commits ahead, reason
4. **Skipped** — branches that failed ancestor test or had `ahead > 0` unexpectedly

### C — Delete remotes

For each delete candidate that still passes audit:

```bash
git push origin --delete cursor/<name>
```

Delete one branch per command; stop and document if any push is rejected.

Optional (local hygiene, same machine only):

```bash
git remote prune origin
```

### D — Update index

- Add a one-line pointer in [`reports/README.md`](./reports/README.md) under a **Hygiene** row linking to `branch-cleanup-manifest.md`
- Mark this handoff **done** at the bottom with date + deleted count

---

## Verification

- `git branch -r | grep cursor/` — kept branches still present; deleted branches gone
- No edits under `src/`, `test/`, or `examples/` (unless accidental typo in handoff — revert)
- Manifest committed on your agent branch

---

## Deliverable

Single PR → `integration/storage` containing:

- `docs/handoffs/archive/2026-07/agents/branch-cleanup-manifest.md`
- Updated `docs/handoffs/reports/README.md`
- This file marked complete

**Branch naming:** `cursor/branch-cleanup-a009` (paste branch name to supervisor when the run starts).

---

## Status

- [x] Audit complete
- [x] Manifest written
- [x] Remotes deleted (18 branches)
- [x] Merged into `integration/storage` (2026-07-09)

**Complete:** 2026-07-09 — Agent 2 deleted 18 merged `cursor/*` remotes; kept active branches per manifest.
[`branch-cleanup-manifest.md`](branch-cleanup-manifest.md). Phase 2: delete `store-cutover-closeout-ce05` and
`branch-cleanup-a009` after supervisor merge (done).
