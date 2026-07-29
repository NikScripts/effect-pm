# Release-prep cleanup (Agent 4)

**Status:** Eng’d 2026-07-29 on `cursor/hyperservice-open-deps-5679` → tip-sync `integration`.  
**Goal:** Clear completed handoffs/plans, dead scripts, publish surface, and tip-contained branches before first release.

## Done

1. **Archived completed handoffs** → `docs/handoffs/archive/2026-07/{agents,features}/`
   - Agent 1 corpus phases, closed Agent 3 briefs, obsolete HTML docs-platform briefs
   - Done cutover satellites (Daemon/WorkPool/Gate/untyped); **kept** `store-cutover-00-store-core.md` at handoffs root
   - Eng’d dated records: examples IA, impossible-states, api-changes, polling decisions, client transport, origin-down, open-asks
2. **Shipped plans** → `docs/plans/archive/` + pruned [`docs/plans/README.md`](../plans/README.md) to future-only
3. **Deleted one-shot scripts:** rename/scrub/patch-process-manager/reorg-examples-ia; `.cursor/metrics-reset-salvage-log.md`
4. **npm publish surface:** `.npmignore` excludes `docs/handoffs/`, `docs/plans/`, `docs/site/`, `docs/docgen/`, agent/dev/scripts
5. **Publishing docs:** refreshed [`PUBLISHING.md`](../../PUBLISHING.md) + [`.changeset/README.md`](../../.changeset/README.md) for `0.9.0-beta.n`
6. **Examples residue:** removed legacy `example:*` compat aliases; updated `example:session` script; cleaned `"forms/…"` service keys
7. **Broken stub:** deleted `view-hover-types.md` (retarget scratch path from view-tag prototype)

## Owner still

- **Consolidate ~65 pending changesets** before `pnpm run version` / publish (do not ship every intermediate add/remove note blindly)
- **E5 apps** — [`examples-apps-e5-plan.md`](./examples-apps-e5-plan.md)

## Remotes after hygiene

**Kept:** `main`, `integration`, `cursor/hyperservice-open-deps-5679` (4), `cursor/tui-dashboard-parity-125f` (G),
`cursor/docs-site-edge-cache-dbdc` (docs site), `archive/command-auth`, `archive/dashboard-readiness`,
`archive/resource-toolkit-web-widgets`.

**Deleted:** tip-contained `cursor/*` / `feat/*` / `refactor/*` work branches (and tip-contained Agent 5/G
alias branches). Unique tips that were already gone upstream at prune time are not resurrected.
