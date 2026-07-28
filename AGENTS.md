# Agent instructions

Start with [`docs/handoffs/agent-status.md`](./docs/handoffs/agent-status.md) for the supervisor bus, [`docs/standards/`](./docs/standards/) for invariants, and the live book under [`docs/index.md`](./docs/index.md).

**Repo CLI:** **`pnpm hyp`** (Effect CLI under `dev/cli/`) owns developer gates. Prefer
`pnpm verify` / `pnpm hyp …` over adding new root scripts. Green gate:
`deps → typecheck → lint → test → build → markers`. See `.cursor/rules/hyp-verify.mdc`.

**Persistence:** Live recipe SSOT — [`docs/guides/stores.md`](./docs/guides/stores.md). Shapes — [`docs/standards/storage.md`](./docs/standards/storage.md). Cutover history — [`docs/handoffs/store-cutover-00-store-core.md`](./docs/handoffs/store-cutover-00-store-core.md) (prefer the guide when they disagree). Logs — [`docs/guides/logs.md`](./docs/guides/logs.md) (+ lookup tables in [`docs/LOGS.md`](./docs/LOGS.md)).

**Integration branch:** **`integration`**. Active handoffs index: [`docs/handoffs/reports/README.md`](./docs/handoffs/reports/README.md).

**Roadmap (future only):** [`docs/plans/README.md`](./docs/plans/README.md).

**Living book:** Prefer `docs/guides/`, `docs/getting-started/`, `docs/services/`, `docs/observe/`, and the [API site](https://hyperlink.cool/api/hyperlink-ts). Do **not** cite `docs/legacy/**` (removed).

**Changesets:** agents may create `.changeset/*.md` without approval; **`pnpm run version` and publish require owner approval**. After creating a changeset, paste the **full file** in owner chat.

## Branch policy

**Format:** `<type>/<description>` — slash-separated, **kebab-case** description.

| Type | Purpose | Typical merge target |
|------|---------|---------------------|
| **`integration`** | Long-lived integration tip | `main` when owner releases |
| **`cursor/<description>-…`** / **`feature/<description>`** | Short-lived agent or developer work | `integration` when owner authorizes tip-sync |
| **`fix/<description>`** | Focused fixes | Same as feature |

**Rules:**

- **One work branch per agent** (e.g. `cursor/<desc>-….`). Do not scatter work across many agent branches.
- **One integration branch:** `integration`. When the owner authorizes a sync, work branch and `integration` end **merged and share the same tip**.
- Branch agent work from **`integration`**, not `main`, for platform work.
- **Do not open PRs** unless the owner asks.
- **Never push `integration` unless the owner explicitly authorizes that push.** Tip-sync / “keep tips aligned” is not blanket permission (2026-07-27 — see [`docs/handoffs/agent-04-w3-incident-2026-07-27.md`](./docs/handoffs/agent-04-w3-incident-2026-07-27.md)). Default: push the **work branch** only.
- Do **not** push to `main`, `develop`, release branches, or owner-owned branches without explicit approval.
- Commits and pushes on agent `cursor/*` branches are allowed when needed for the task.

## Effect platform policy

- Use Effect platform/node services for filesystem, process, HTTP, terminal, and
  other Node runtime work (`FileSystem`, `Path`, `ChildProcess`, NodeServices,
  etc.).
- Avoid raw `node:*` APIs in new code when an Effect service exists. If no Effect
  service exists for the primitive (for example Ed25519 crypto), isolate the
  Node API behind a small Effect-returning helper.

## Repository map (quick)

| Path | Purpose |
|------|---------|
| `src/*.ts` | Public modules (PascalCase) — start at `src/index.ts` |
| `src/internal/` | Package-only; never exported, no subpath |
| `docs/guides/`, `docs/getting-started/`, `docs/services/`, `docs/observe/` | Living book |
| `docs/standards/` | Enforced invariants (manifest) |
| `docs/handoffs/` | Active designs + agent status bus |
| `docs/plans/` | Future-only roadmap |
| `examples/forms/`, `examples/scenarios/` | Teaching scripts — [`examples/README.md`](./examples/README.md) |
| `repos/effect/` | Vendored Effect (read-only; do not import) |
| `test/*.ts` | Vitest — `pnpm test` |

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

## Cursor Cloud

**Environment:** Node >= 20.19 and pnpm 10.33.4 (`package.json`). Use `pnpm install` in a fresh workspace.

**Key commands:** `pnpm run typecheck` · `pnpm test` · `pnpm run lint` · `pnpm run build` · `pnpm verify`.

**Gotchas:** `prepare` patches TypeScript with `@effect/language-service` (expected). HTTP examples bind localhost ports — free the port or pick another if bind fails.
