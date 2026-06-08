# Agent guide — effect-pm (`@nikscripts/effect-pm`)

Use this file **together with** [STORAGE.md](./STORAGE.md) (**read before any persistence change** — module refactor list, facet rules, agent assignments), [plans/21-state-vocabulary.md](./plans/21-state-vocabulary.md) (**telemetry vs process vs projection vs durable ops**), [handoffs/telemetry-implementation-handoff.md](./handoffs/telemetry-implementation-handoff.md) (**telemetry implementation — start here**), [recipes/telemetry-requirements.md](./recipes/telemetry-requirements.md) (**telemetry API SSoT — steps 0–10, CHK list**), [recipes/telemetry-split-bake.md](./recipes/telemetry-split-bake.md) (**bake rationale — historical API sections superseded by requirements**), [PACKAGE-GUIDE.md](./PACKAGE-GUIDE.md), [PROCESS-API.md](./PROCESS-API.md), [RESOURCE-API.md](./RESOURCE-API.md), [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md) (schedule vs `ProcessGroup.start` / API gates), and [examples/README.md](../examples/README.md). It tells you **where truth lives** and **how to modify the repo safely**.

---

## Repository map

| Path | Purpose |
|------|---------|
| `src/index.ts` | Public exports + package-level TSDoc. **Start here for imports.** |
| `src/Process.ts` | `Process.make`, supervisor loop, `ProcessSupervisorRequirements`. |
| `src/ProcessGroup.ts` | Orchestration, `make`, fork/stop, typed controls, `awaitShutdown`. |
| `src/Polling.ts`, `src/ProcessSchedule.ts` | Cadence + gate services and preset `Layer`s. |
| `src/QueueResource.ts` | Priority queue resource factory. |
| `src/ResourceConfigure.ts` | Layer-composed `.configure` patches for queue/process/run services. |
| `src/ProcessStore.ts`, `src/ProcessStorage.ts`, `src/ProcessStoreEvent.ts` | Storage facet builder, combined facet layers, and shared event types. |
| `src/store/*.ts` | Storage facets → `@nikscripts/effect-pm/store/*` (PascalCase files flat under `store/`; no domain subfolders) |
| `src/sink/` | TelemetryHub sink legs → `@nikscripts/effect-pm/sink/*` |
| `src/TelemetryHub.ts` | Global telemetry router → `@nikscripts/effect-pm/TelemetryRouter` (rename in progress; was TelemetryHub) |
| `src/*Projection.ts`, `src/*Transport.ts` | Live projection + semantic transports (camelCase transport filenames) |
| `src/LogContext.ts`, `src/LogEntry.ts`, `src/Transport.ts` | PM log annotations, NDJSON log entries, transport config. |
| `src/internal/store/spine.ts`, `service.ts`, `helpers.ts` | Shared storage plumbing — internal. Type-agnostic only; per-facet codecs live next to each facet in `src/store/`. |
| `src/internal/manager/*` | PM child launch, log capture/relay/query, group watch — **internal**. |
| `src/ControlService.ts` | Localhost HTTP JSON control API. |
| `src/react/` | Headless `ControlPlanePort`, hooks, adapters (`@nikscripts/effect-pm/react`). |
| `src/ops-ui/` | Styled ops dashboard (Tailwind/shadcn); future package — [guides/dashboard-ops-ui.md](./guides/dashboard-ops-ui.md). |
| `src/Logs.ts` | PM capture/relay only (`captureLoggerLayer`, `relayLayer`) — package subpath `@nikscripts/effect-pm/Logs`. |
| `src/ProcessManager.ts` | Typed remote client and endpoint service for group control contracts. |
| `src/cli.ts` | `createCli` / `runCli` — HTTP client for control API. |
| `src/disarmedIdleSleep.ts` | Pure policy for disarmed idle sleep (shared with tests). |
| `src/prisma/*` | Optional Prisma adapter (`@nikscripts/effect-pm/prisma` export). |
| `examples/forms/*` | One API shape per file — minimal teaching references. |
| `examples/scenarios/*` | Descriptive compositions showing subsystems together. |
| `examples/shared/*` | Test doubles, harness helpers, shared example utilities. |
| `docs/guides/*.md` | API guides (definition forms, config, types); **`service-tags-and-runtime-split.md`** = bundler‑safe tags vs **`Layer`/runtime`; **`dashboard-integration.md`** = embeddable widgets + **`peerDependency`** + topology. Merge with `docs/rewrite/` over time. |
| `docs/plans/*.md` | Future-only roadmap items. Implemented behavior belongs in regular docs and source TSDoc. |
| `repos/effect/` | Vendored Effect source for read-only agent reference. **Do not import from it.** |
| `test/*.ts` | Vitest suites — run `pnpm test`. |

---

## Invariants (do not break casually)

1. **Supervisor semantics** — One fiber per started process; outer loop waits for **armed** schedule; inner loop runs **polling** ticks while armed. See `Process.ts` module doc and `docs/SCHEDULE-AND-PROCESSGROUP.md`.
2. **`Process.effect` typing** — `Process<R>`: `effect` needs the user environment plus optional storage facets supplied by `ProcessStorage.layer`. Inlined `polling` / `schedule` on `Process.make` are merged into the supervisor so **`R` excludes those services** when present (overload-resolved in `Process.ts`).
3. **ProcessGroup combined requirements** — `AllGroupProcessesRequirements` unions `Effect.Services<p["effect"]>` across processes; app must provide that environment when calling `startAll`, etc.
4. **Control API security** — `ControlService` binds to **127.0.0.1** only.
5. **Storage** — See [STORAGE.md](./STORAGE.md) only (`RuntimeStorage` + `src/store/*` facets, `ProcessStore` builder, `ProcessStorage` combined layers, logs split, refactor list, agent assignments).

---

## Public vs internal modules

**Rule:** If consumers import it in their app → public module under `src/` (PascalCase) and
documented export (`index.ts` or a `package.json` subpath). If only other package modules
use it → `src/internal/` — not exported from `index.ts`, no new subpath.

See [`.cursor/rules/public-vs-internal.mdc`](../.cursor/rules/public-vs-internal.mdc) for
the full **module placement** table (role folders, subpaths, layer exports).

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
- Commits, pushes, PR creation/update, and merges on major or user-owned
  branches (`main`, `develop`, release branches, or branches created by the
  user) require user approval first.
- Agent-created `cursor/*` branches are the exception: commits, pushes, and PR
  creation/update are allowed there when needed for the task.
- Keep docs and plans separate: regular docs describe implemented behavior;
  `docs/plans` describes future work only.
- Prefer existing Effect patterns, services, and local helper APIs over ad hoc
  abstractions.
- Use Effect platform/node services for filesystem, process, HTTP, terminal, and
  other Node runtime work (`FileSystem`, `Path`, `ChildProcess`, NodeServices,
  etc.). Avoid raw `node:*` APIs in new code when an Effect service exists; if
  no Effect service exists for the primitive (for example Ed25519 crypto),
  isolate the Node API behind a small Effect-returning helper.
- Use comments and TSDoc to make intent clear when code relies on non-obvious
  type-level plumbing, Effect layering/order, runtime ownership, or compatibility
  behavior. Lean toward assuming future readers will not have the whole design
  discussion in their head; a concise comment is better than making them infer
  invariants from implementation details.
- Make validation deterministic from type/config shape where possible; avoid
  extra boolean flags for behavior that can be derived.
- Hooks should be powerful extension points, but core persistence/analytics
  should be automatic through storage facets.
- End responses in a way that keeps development moving: identify the next
  sensible slice, call out blockers or uncertainty, and ask for clarification
  when a decision is needed. Avoid passive endings that only summarize completed
  work; leave the user with the concrete next plan or next question.

---

## Common tasks

| Task | Approach |
|------|----------|
| Add a public export | Add the symbol to the module **namespace** object, export the same binding at the module top level (short name), then re-export namespace + short name from `src/index.ts`. Add a `tsup` entry and `package.json` `exports` subpath when the module is a standalone import surface. |
| Change process semantics | Update `src/Process.ts`, tests in `test/process*.ts`, and the relevant regular docs if behavior is contractual. |
| Add an example | Add a **form** under `examples/forms/<area>/` or a **scenario** under `examples/scenarios/`; document in `examples/README.md`; add `package.json` script if runnable. Put heavy mock / scenario prose in `examples/shared/` when it would drown the entry script. |
| Verify types (strict Effect rules) | `pnpm run typecheck` (uses `tsgo`). `anyUnknownInErrorContext` is temporarily `"off"`; see [strict any/unknown plan](./plans/10-typescript-strict-unknown.md). |
| Run tests | `pnpm test` |
| Implement store / runtime / group roadmap | Follow [`STORAGE.md`](./STORAGE.md) for storage work and [`docs/plans/README.md`](./plans/README.md) for priority order. Remote/control/queue-wire: [`01-remote-cli-transport-wire.md`](./plans/01-remote-cli-transport-wire.md), [`03-queue-remote-handoff.md`](./plans/03-queue-remote-handoff.md). Storage polish: [`11-storage-prisma-follow-up.md`](./plans/11-storage-prisma-follow-up.md). |

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

---

## Cursor Cloud specific instructions

**Environment:** Node >= 20.19.0 and pnpm 10.33.4 are declared by
`package.json`. A `pnpm-lock.yaml` is committed; use `pnpm install` when
dependencies are missing in a fresh cloud workspace.

**No external services required for the standard checks.** The Vitest suites and
examples run in-process. SQLite `RuntimeStorage` tests exercise
`@effect/sql-sqlite-node`. Prisma `RuntimeStorage` tests use both structural
mocks and a generated Prisma SQLite client in a temporary project.
`package.json` lists `better-sqlite3` under `pnpm.onlyBuiltDependencies` so the
transitive native dependency can compile when installs run with ignored scripts
by default.

**Key commands:**

| Task | Command |
|------|---------|
| Install dependencies | `pnpm install` |
| Typecheck | `pnpm run typecheck` |
| Run tests | `pnpm test` |
| Lint | `pnpm run lint` |
| Build | `pnpm run build` |
| Typed PG walkthrough | `pnpm run example:typed-process-group` |

**Gotchas:**

- `pnpm install` runs the `prepare` hook, which patches TypeScript with
  `@effect/language-service`; seeing `effect-language-service patch` output is
  expected.
- The generated Prisma integration test invokes the local `prisma` CLI,
  `prisma db push`, and `prisma generate`; if a restricted environment blocks
  Prisma engine install scripts, run `pnpm approve-builds` for `prisma` /
  `@prisma/engines` and reinstall before testing.
- Examples using `ControlService` bind to localhost ports. If an example fails
  because a port is already in use, rerun with a free port or stop the specific
  process that owns that port.
