# Publishing Guide

Current package version: see `package.json` (prerelease line `0.9.0-beta.n` as of this writing).

## Prerequisites

- `npm whoami` (or `npm login`)
- Working tree clean on the release tip
- Owner approval before **`pnpm run version`** and publish (agents may create `.changeset/*.md` freely)

## Steps

### 1. Changesets

```bash
pnpm run changeset
```

Pending files live in `.changeset/`. Before a first public release, consolidate intermediate
add/remove churn into coherent release notes rather than shipping every historical note verbatim.

**Prerelease:** with changesets in `pre` mode, `changeset version` may bump only the prerelease
segment (`0.9.0-beta.0` → `0.9.0-beta.1`). For a new beta line, set `package.json` / `CHANGELOG.md`
deliberately under owner direction.

### 2. Version (owner-approved)

```bash
pnpm run version
```

This consumes `.changeset/*.md`, updates `package.json`, and regenerates `CHANGELOG.md`.
It does **not** create a git commit (`changeset` config `commit: false`) — commit yourself.

### 3. Build & verify

```bash
pnpm run build
pnpm run typecheck
pnpm pack --dry-run   # confirm published paths (handoffs/plans/site excluded)
```

### 4. Publish

```bash
pnpm run release
# or: npm publish --tag beta
```

### 5. Push

```bash
git push --follow-tags
```

## What ships on npm

Via `package.json` `"files"` + `.npmignore`:

- **Included:** `dist/`, `src/`, living docs (guides/services/getting-started/…), README, LICENSE, CHANGELOG
- **Excluded:** `docs/handoffs/`, `docs/plans/`, `docs/site/`, `docs/docgen/`, `examples/` (clone the repo), agent/supervisor material, `dev/`, `scripts/`

## Quick checks

```bash
npm publish --dry-run
npm pack --dry-run
npm info hyperlink-ts
```

## Troubleshooting

**"Version already exists"** — run `pnpm run version` (or bump) before publish.

**"Not logged in"** — `npm login`.

**Build fails** — `pnpm run clean && pnpm install && pnpm run build`.
