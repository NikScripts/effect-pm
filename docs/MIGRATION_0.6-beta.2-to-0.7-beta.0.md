# Migration & publish plan: `0.6.0-beta.2` → `0.7.0-beta.0`

This document is the **operator checklist** for moving consumers and publishing **`@nikscripts/effect-pm@0.7.0-beta.0`** to npm. Code migration details for Process v2 live in **[MIGRATION_0.7.0-process-v2.md](../MIGRATION_0.7.0-process-v2.md)**; API tables in **[PROCESS-API.md](./PROCESS-API.md)**.

---

## 1. Why a new minor line (`0.7.x`)

Pre-1.0 semver: **`0.7.x`** signals the **Process v2** breaking surface (`Process.make` no longer takes `crons`; **`Polling`** + **`ProcessSchedule`** layers, new supervisor semantics, new exports). Staying on **`0.6.0-beta.x`** would mislead consumers who pin `^0.6.0-beta.2`.

---

## 2. Consumer migration (application code)

| Step | Action |
|------|--------|
| 1 | Bump dependency: `npm install @nikscripts/effect-pm@0.7.0-beta.0` (or exact tag after publish). |
| 2 | Replace **`Process.make({ crons, … })`** with **`effect`** + **`schedule: ProcessSchedule.cronMatch({ crons })`** (and **`polling: Polling.spaced(…)`**). See [MIGRATION_0.7.0-process-v2.md](../MIGRATION_0.7.0-process-v2.md). |
| 3 | Merge **`ProcessStore.layer`** (or Prisma adapter) wherever you fork **`process.effect`** or run **`ProcessGroup`**. |
| 4 | If you relied on “supervisor exits when disarmed”, update to **one `startAll`** and let **arm/disarm** control ticks (or call **`stopProcess`** when you truly want the fiber gone). |
| 5 | Optional: use **`computeDisarmedIdleSleep`** or **`fromArmedRef` + `nextScheduleTransition`** for tests / custom gates. |

---

## 3. Maintainer: prep to publish npm

### 3.1 Preconditions

- [ ] **`git status`** clean; all work on **`main`** (or release branch) pushed as needed.
- [ ] **`package.json`** version is **`0.7.0-beta.0`**.
- [ ] **`CHANGELOG.md`** has **`## 0.7.0-beta.0`** with accurate notes.
- [ ] **`.changeset/`** contains **no** pending `*.md` changesets you intend to ship later (or they will bump the next version unexpectedly). Orphaned historical changeset files were moved to **`docs/orphaned-changesets-archive/`** so they are not consumed.
- [ ] **`npm whoami`** succeeds.

### 3.2 Verification commands

```bash
npm install
npm run test
npm run build
npm pack --dry-run
```

Optional: `npm publish --dry-run`

### 3.3 Publish

Per [PUBLISHING.md](../PUBLISHING.md):

```bash
npm publish
# Prerelease on the beta dist-tag is normal for 0.7.0-beta.0:
# npm publish --tag beta   # if your default tag policy requires it
```

Then:

```bash
git push origin main
# If you use version tags from changesets:
git push --follow-tags
```

### 3.4 Post-publish

- [ ] Confirm: `npm info @nikscripts/effect-pm version`
- [ ] Announce breaking migration link: `MIGRATION_0.7.0-process-v2.md` + `docs/PROCESS-API.md`

---

## 4. Versioning note (Changesets + prerelease)

`changeset version` in **`pre`** mode with a **minor** changeset from **`0.6.0-beta.2`** produced **`0.6.0-beta.3`**, not **`0.7.0-beta.0`**. For this release the **package version was set explicitly** to **`0.7.0-beta.0`** and the changelog was edited by hand. For the **next** change, add a new `.changeset/*.md` and run `npm run version` again, or continue hand-editing if you exit prerelease mode.

---

## 5. Files touched for this plan

| Path | Role |
|------|------|
| `package.json` | **`version`:** `0.7.0-beta.0` |
| `CHANGELOG.md` | **`0.7.0-beta.0`** section |
| `docs/MIGRATION_0.6-beta.2-to-0.7-beta.0.md` | This checklist |
| `docs/orphaned-changesets-archive/` | Old changeset bodies kept for archaeology only |
