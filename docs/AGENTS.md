# Agent guide — effect-pm (`@nikscripts/effect-pm`)

Use this file **together with** [PACKAGE-GUIDE.md](./PACKAGE-GUIDE.md), [PROCESS-API.md](./PROCESS-API.md), [RESOURCE-API.md](./RESOURCE-API.md), [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md) (schedule vs `ProcessGroup.start` / API gates), and [examples/README.md](../examples/README.md). It tells you **where truth lives** and **how to modify the repo safely**.

---

## Repository map

| Path | Purpose |
|------|---------|
| `src/index.ts` | Public exports + package-level TSDoc. **Start here for imports.** |
| `src/Process.ts` | `Process.make`, supervisor loop, `ProcessSupervisorRequirements`. |
| `src/ProcessGroup.ts` | Orchestration, `make`, fork/stop, `serve`, `awaitShutdown`. |
| `src/Polling.ts`, `src/ProcessSchedule.ts` | Cadence + gate services and preset `Layer`s. |
| `src/QueueResource.ts` | Priority queue resource factory. |
| `src/ProcessStore.ts` | Analytics + lifecycle event append/read. |
| `src/ControlService.ts` | Localhost HTTP JSON control API. |
| `src/cli.ts` | `createCli` / `runCli` — HTTP client for control API. |
| `src/disarmedIdleSleep.ts` | Pure policy for disarmed idle sleep (shared with tests). |
| `src/prisma/*` | Optional Prisma adapter (`@nikscripts/effect-pm/prisma` export). |
| `examples/*` | Runnable teaching scripts. |
| `examples/mocks/*` | Test doubles, scenario docs, **`demo-harness.mock.ts`** (`forkChild` + `TestClock` + Node exit). |
| `docs/plans/*.md` | Future-only roadmap items. Implemented behavior belongs in regular docs and source TSDoc. |
| `docs/plans/10-agent-implementation-roadmap.md` | **Meta roadmap** for agents: phased implementation of plans 01–09, code sketches, verification. Read after [`docs/plans/README.md`](./plans/README.md). |
| `repos/effect/` | Vendored Effect source for read-only agent reference. **Do not import from it.** |
| `test/*.ts` | Vitest suites — run `pnpm test`. |

---

## Invariants (do not break casually)

1. **Supervisor semantics** — One fiber per started process; outer loop waits for **armed** schedule; inner loop runs **polling** ticks while armed. See `Process.ts` module doc and `docs/SCHEDULE-AND-PROCESSGROUP.md`.
2. **`Process.effect` typing** — `Process<R>`: `effect` needs `R | ProcessStore`. Inlined `polling` / `schedule` on `Process.make` are merged into the supervisor so **`R` excludes those services** when present (overload-resolved in `Process.ts`).
3. **ProcessGroup combined requirements** — `AllGroupProcessesRequirements` unions `Effect.Services<p["effect"]>` across processes; app must provide that environment when calling `startAll`, etc.
4. **Control API security** — `ControlService` binds to **127.0.0.1** only.

---

## Engineering and change-management rules

- Prefer type-safe designs over casts; do not use unsafe type casts to bypass
  TypeScript.
- Narrow unknown values with predicates, schemas, or typed APIs instead of
  assertion-heavy code.
- Fix type errors wherever they appear during a task; do not ignore unrelated
  type failures.
- Typecheck frequently while editing Effect-heavy or public API code.
- For non-trivial changes, validate with `pnpm run typecheck`, `pnpm test`,
  `pnpm run build`, and `pnpm run lint` unless the task is docs-only or the
  user explicitly narrows testing.
- Recommend a changeset whenever public API, behavior, package metadata, or
  release notes are affected. Creating or editing a changeset requires user
  approval.
- Recommend commits, PRs, or merges when appropriate.
- Commits, PR creation/update, and merges to branches created by the user
  require user approval first.
- Commits, PR creation/update, and pushes on agent-created branches are allowed
  when needed for the task.
- Keep docs and plans separate: regular docs describe implemented behavior;
  `docs/plans` describes future work only.
- Prefer existing Effect patterns, services, and local helper APIs over ad hoc
  abstractions.
- Make validation deterministic from type/config shape where possible; avoid
  extra boolean flags for behavior that can be derived.
- Hooks should be powerful extension points, but core persistence/analytics
  should be automatic through services such as `ProcessStore`.

---

## Common tasks

| Task | Approach |
|------|----------|
| Add a public export | Edit `src/index.ts` + add TSDoc `@public` on the symbol in its module. |
| Change process semantics | Update `src/Process.ts`, tests in `test/process*.ts`, and the relevant regular docs if behavior is contractual. |
| Add an example | Add `examples/foo.ts`, document in `examples/README.md`, add `package.json` script if runnable. Put heavy mock / scenario prose in `examples/mocks/*.mock.ts` when it would drown the entry script. |
| Verify types (strict Effect rules) | `pnpm run typecheck` (uses `tsgo`). `anyUnknownInErrorContext` is temporarily `"off"`; see [strict any/unknown plan](./plans/09-strict-any-unknown.md). |
| Run tests | `pnpm test` |
| Implement store + queue roadmap | Follow numbered plans in [`docs/plans/README.md`](./plans/README.md); use phased slice order in [`docs/plans/10-agent-implementation-roadmap.md`](./plans/10-agent-implementation-roadmap.md). |

---

## Vendored repositories

- External source lives under `repos/` only to help agents inspect upstream implementations and tests.
- Treat `repos/effect/` as read-only reference material for idiomatic Effect patterns.
- Never import from `repos/`; package code must import from declared dependencies such as `effect`.
- Do not edit files under `repos/` unless explicitly asked.
- When changing Effect-heavy code, inspect `repos/effect/packages/effect/` for examples before introducing new patterns.

---

## Documentation conventions

- Use **`@public`** / **`@internal`** on exported symbols as appropriate.
- Prefer **module-level** `@module` / overview blocks for large files (`Process.ts`, `QueueResource.ts`).
- Link cross-doc with **relative** paths from `docs/` or repo root as in README.

---

## What not to assume

- **`AI_CONTEXT.md`** in repo root may be gitignored locally; committed agent guidance starts in root `AGENTS.md` and continues here.
