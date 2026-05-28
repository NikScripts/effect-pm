# Handoff: `src/ops-ui` — local agent (effect-pm repo)

**Audience:** Local Cursor agent on **effect-pm** after dashboard slices 1–2 and storage follow-up are on **`main`**.  
**Plan:** [../guides/dashboard-ops-ui.md](../guides/dashboard-ops-ui.md)  
**Branch:** Work on **`main`** (feature branches merged; no long-lived dashboard branch).

---

## Context

| Layer | Path | Status |
|-------|------|--------|
| Control spine | `ControlService`, `ControlPlanePort` | On `main` |
| Headless React | `src/react/` | On `main` (hooks, slots, unstyled panels) |
| Storage semantics | `ProcessStore.catchErrorAndLog`, `docs/STORAGE.md` | On `main` @ `7335c56+` |
| Styled ops UI | `src/ops-ui/` | **Not started** — your job (Phase 1+) |
| Demo | `examples/dashboard-demo/` | Unstyled Vite app today → becomes styled playground |

**Do not** add Tailwind or shadcn under `src/react/`. **Do not** import ops-ui from core runtime modules.

---

## Prerequisites (run first)

```bash
git checkout main
git pull origin main
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run lint
```

Confirm exports exist:

```bash
node -e "const p=require('./package.json'); console.log(p.exports['./react'], p.exports['./react/adapters/fetch'])"
```

---

## Phase 1 scope (this handoff)

1. Create **`src/ops-ui/`** per plan (index, shadcn `components/ui`, theme/tailwind wiring).
2. Add root **devDependencies**: `tailwindcss`, `postcss`, `autoprefixer`, `class-variance-authority`, `clsx`, `tailwind-merge`, Radix primitives shadcn needs, `@tanstack/react-table` (table UI in Phase 2; dep OK in Phase 1).
3. Wire **`examples/dashboard-demo/web`**: Tailwind, content paths for `src/ops-ui/**/*`, replace inline styles with **`OperatorDashboard`** from ops-ui.
4. Add **`package.json` export** `"./ops-ui"` pointing at `src/ops-ui/index.ts` (source export for subtree consumers; **do not** add ops-ui to root `tsup` until build story is clear).
5. Update docs: [dashboard-styling.md](../guides/dashboard-styling.md), [examples/dashboard-demo/README.md](../../examples/dashboard-demo/README.md).
6. Mark unstyled `OperatorControlPanel` / panels as **@deprecated** in TSDoc only (keep exports).
7. **`tsconfig.json`**: include `src/ops-ui` if needed for typecheck.
8. Verify commands above + manual demo (pm + ui terminals).

**Out of scope Phase 1:** TanStack Table columns (Phase 2), WOW repo changes, changeset (ask owner), monorepo workspace.

---

## Invariants

- `src/react` never imports `src/ops-ui`.
- Browser never calls `127.0.0.1:3001` directly; demo uses `/api/control` + Vite proxy.
- Slot types in `src/react/slots.ts` may be reused internally by ops-ui; prefer composing headless hooks.
- Effect language service: use `@effect-diagnostics` on React hooks if DTS build complains (see existing panels).
- Strict boolean expressions: use `slots.foo !== undefined` not `slots.foo ?` in conditions.

---

## File checklist (Phase 1)

| Action | Path |
|--------|------|
| Create | `src/ops-ui/index.ts` |
| Create | `src/ops-ui/OperatorDashboard.tsx` |
| Create | `src/ops-ui/components/ui/*` (shadcn) |
| Create | `src/ops-ui/globals.css` or shared styles imported from demo |
| Edit | `examples/dashboard-demo/web/App.tsx` |
| Edit | `examples/dashboard-demo/web/vite.config.ts` (if needed) |
| Edit | `package.json` exports + devDependencies |
| Edit | `docs/guides/dashboard-styling.md` |
| Edit | `examples/dashboard-demo/README.md` |

---

## Phase 2 preview (after Phase 1 merges)

- `ProcessStatusTable`, `QueueStatusTable` with `@tanstack/react-table` + shadcn `Table`.
- Replace list UI inside `OperatorDashboard`.

---

## Release / changeset

Owner approves changesets. After Phase 1+2 public API, recommend changeset for new `./ops-ui` export (minor).

---

# PROMPT — copy into local agent

```markdown
You are working in the **effect-pm** repo on branch **main**.

**Task:** Implement **Phase 1** of the dashboard ops UI plan.

**Read first:**
- `docs/guides/dashboard-ops-ui.md`
- `docs/guides/dashboard-integration.md`
- `docs/handoffs/dashboard-ops-ui-local-agent.md` (this file)

**Goal:** Add `src/ops-ui/` with Tailwind + shadcn and an `OperatorDashboard` component. Update `examples/dashboard-demo/web` to use it. Add `package.json` export `./ops-ui`. Keep `src/react/` headless only.

**Rules:**
- No Tailwind/shadcn in `src/react/`.
- No imports from ops-ui into Process/ControlService/storage.
- Reuse `ControlPlaneProvider`, `createFetchControlPlaneAdapter`, hooks from `src/react`.
- Run `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm run lint` before finishing.
- Manual check: `pnpm run example:dashboard-demo:pm` and `:ui` in two terminals.
- Do not commit without owner approval if they require it; otherwise commit with a clear message on `main` or ask which branch to use.

**Do not:** WOW repo work, monorepo workspace, TanStack Table (Phase 2), changeset without approval.

**Report:** files created, export path, how to run demo, any WOW Tailwind version assumptions, blockers.
```

---

*After Phase 1 lands on `main`, WOW agents should subtree-pull `main` and follow slice 3 in `wow-dashboard-slice-2-agent-prompts.md` (updated for `./ops-ui` when available).*
