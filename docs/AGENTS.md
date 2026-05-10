# Agent guide — effect-pm (`@nikscripts/effect-pm`)

Use this file **together with** [PACKAGE-GUIDE.md](./PACKAGE-GUIDE.md), [PROCESS-API.md](./PROCESS-API.md), [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md) (schedule vs `startProcess` / API gates), and [examples/README.md](../examples/README.md). It tells you **where truth lives** and **how to modify the repo safely**.

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
| `examples/*` | Runnable teaching scripts (**not** published). |
| `examples/mocks/*` | Test doubles, scenario docs, **`demo-harness.mock.ts`** (`forkChild` + `TestClock` + Node exit). |
| `docs/plans/*.md` | Architecture contracts; **09** is canonical for process v2. |
| `test/*.ts` | Vitest suites — run `pnpm test`. |

---

## Invariants (do not break casually)

1. **Supervisor semantics** — One fiber per started process; outer loop waits for **armed** schedule; inner loop runs **polling** ticks while armed. See `Process.ts` module doc and plan **09**.
2. **`Process.effect` typing** — `Process<R>`: `effect` needs `R | ProcessStore`. Inlined `polling` / `schedule` on `Process.make` are merged into the supervisor so **`R` excludes those services** when present (overload-resolved in `Process.ts`).
3. **ProcessGroup combined requirements** — `AllGroupProcessesRequirements` unions `Effect.Services<p["effect"]>` across processes; app must provide that environment when calling `startAll`, etc.
4. **Control API security** — `ControlService` binds to **127.0.0.1** only.

---

## Common tasks

| Task | Approach |
|------|----------|
| Add a public export | Edit `src/index.ts` + add TSDoc `@public` on the symbol in its module. |
| Change process semantics | Update `src/Process.ts`, tests in `test/process*.ts`, and plan **09** if behavior is contractual. |
| Add an example | Add `examples/foo.ts`, document in `examples/README.md`, add `package.json` script if runnable. Put heavy mock / scenario prose in `examples/mocks/*.mock.ts` when it would drown the entry script. |
| Verify types | `npx tsc --noEmit` |
| Run tests | `pnpm test` |

---

## Documentation conventions

- Use **`@public`** / **`@internal`** on exported symbols as appropriate.
- Prefer **module-level** `@module` / overview blocks for large files (`Process.ts`, `QueueResource.ts`).
- Link cross-doc with **relative** paths from `docs/` or repo root as in README.

---

## What not to assume

- **`examples/`** is not on the npm package payload by default; consumers read GitHub or a monorepo checkout.
- **`AI_CONTEXT.md`** in repo root may be gitignored locally; this **`docs/AGENTS.md`** is the **committed** agent entry.
