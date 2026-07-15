# Agent instructions

Start with [`docs/handoffs/agent-status.md`](./docs/handoffs/agent-status.md) for the supervisor bus, [`docs/standards/`](./docs/standards/) for invariants, and the live book under [`docs/index.md`](./docs/index.md).

**Persistence:** Live recipe SSOT — [`docs/guides/stores.md`](./docs/guides/stores.md). Cutover history — [`docs/handoffs/store-cutover-00-store-core.md`](./docs/handoffs/store-cutover-00-store-core.md) (prefer the guide when they disagree).

**Integration branch:** **`integration`**. Active handoffs index: [`docs/handoffs/reports/README.md`](./docs/handoffs/reports/README.md).

**Roadmap (future only):** [`docs/plans/README.md`](./docs/plans/README.md).

**Branches:** `<type>/<description>` (e.g. `feature/store-release-hygiene`, `cursor/…`). Agent work branches may commit and push freely; merge into **`integration`** when green and directed. Do not commit or push on `main` / `develop` / release / user-owned branches without approval. **`integration`** pushes require owner direction (or explicit handoff/supervisor OK).

**Changesets:** agents may create `.changeset/*.md` without approval; **`pnpm run version` and publish require owner approval**. After creating a changeset, paste the **full file** in owner chat.

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
