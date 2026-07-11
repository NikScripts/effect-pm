# Agent instructions

Start with [`docs/legacy/AGENTS.md`](./docs/legacy/AGENTS.md) for this package's architecture, invariants, and verification commands.

**Persistence:** [`docs/legacy/STORAGE.md`](./docs/legacy/STORAGE.md) only.

**Integration branch:** `integration/storage` — store cutover + tag wire renames land here before `main`. Active handoffs index: [`docs/handoffs/reports/README.md`](./docs/handoffs/reports/README.md).

**Branches:** `<type>/<description>` (e.g. `integration/storage`, `feature/store-release-hygiene`). Policy: [`docs/AGENTS.md`](./docs/AGENTS.md#branch-policy).

**Changesets:** agents may create `.changeset/*.md` without approval; **`pnpm run version` and publish require owner approval**. After creating a changeset, paste the **full file** in owner chat. Policy: [`docs/AGENTS.md`](./docs/AGENTS.md#changeset-policy).

## Git commit policy

- Do not commit or push directly on major or user-owned branches such as `main`,
  `develop`, release branches, or a branch the user created unless the user
  approves that operation.
- Agent work branches (`feature/*`, `fix/*`, legacy `cursor/*`) may commit and push
  freely; merge into the handoff's **`integration/<stream>`** when green and directed.
- **`integration/*`** pushes require owner direction (or explicit handoff/supervisor OK).

## Effect platform policy

- Use Effect platform/node services for filesystem, process, HTTP, terminal, and
  other Node runtime work (`FileSystem`, `Path`, `ChildProcess`, NodeServices,
  etc.).
- Avoid raw `node:*` APIs in new code when an Effect service exists. If no Effect
  service exists for the primitive (for example Ed25519 crypto), isolate the
  Node API behind a small Effect-returning helper.

## Vendored repositories

External repositories live under `repos/` as read-only reference material, tracked as **git submodules**.

- `repos/effect` is a submodule of **effect-smol** (Effect **v4**), tracking `main`. The Effect source
  is at `repos/effect/packages/effect/src/`. NOT v3 — do not trust any "stale v3" assumption.
- **Init after clone:** `git submodule update --init --depth 1`.
- **Pull latest upstream:** `git submodule update --remote repos/effect` (then commit the bumped pointer).
- Use the submodule to inspect idiomatic upstream source, tests, module structure, and API design — when
  writing Effect code, read `repos/effect/packages/effect/src/` (or the installed `node_modules/effect/src/`
  for the exact pinned version) before guessing from memory.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/`; application and package code import from normal package dependencies.
