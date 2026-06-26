# Agent guide — effect-pm (`@nikscripts/effect-pm`)

Use this file **together with** [STORAGE.md](./STORAGE.md) (**read before any persistence change** — facet rules, the persistence SSOT), [PACKAGE-GUIDE.md](./PACKAGE-GUIDE.md), [PROCESS-API.md](./PROCESS-API.md), [RESOURCE-API.md](./RESOURCE-API.md), [guides/toolkit-by-example.md](./guides/toolkit-by-example.md), [guides/history-and-persistence.md](./guides/history-and-persistence.md), and [examples/README.md](../examples/README.md). It tells you **where truth lives** and **how to modify the repo safely**.

---

## Repository map

| Path | Purpose |
|------|---------|
| `src/index.ts` | Public exports + package-level TSDoc. **Start here for imports.** |
| `src/Process.ts` | `Process.make`, supervisor loop, `ProcessSupervisorRequirements`. |
| `src/Polling.ts`, `src/ProcessSchedule.ts` | Cadence + gate services and preset `Layer`s. |
| `src/QueueResource.ts` | Priority queue **engine** (`Tag`/`make`/`layer`/`server`/`serveHttp`; `persist`/`refill`). |
| `src/ResourceConfigure.ts` | Layer-composed `.configure` patches for queue/process/run resources. |
| `src/HistoryStore.ts`, `src/DurableQueueStore.ts` | Observability history + durable queue ports (SQLite backends in `storage/sqlite`). |
| **Toolkit (location-transparent)** | |
| `src/Resource.ts` | Foundation — tags (`Tag`/`client`/`server`/`serveHttp`/`Host`/`connect`), `specOf`/`methodMeta` introspection. |
| `src/QueueContract.ts` | Toolkit **queue** (`QueueResource` = `Tag`/`layer`/`configure`/`server`/`serveHttp`) → `@nikscripts/effect-pm/QueueContract`. |
| `src/ScheduledProcess.ts` | Toolkit **process** (`ScheduledProcess`). |
| `src/ProcessScheduleContract.ts` | Toolkit **schedule** (`ProcessScheduleResource`) — CRUD + reconcile + `changes`. |
| `src/Group.ts` | `Group.Tag` — organize member tags (nestable; `members`/`isGroup`). |
| `src/HostLogs.ts` | Runtime-wide log capture + stream (`HostLogs`). |
| `src/ProcessStore.ts`, `src/ProcessStorage.ts`, `src/ProcessStoreEvent.ts` | Storage facet builder, combined facet layers, and shared event types. |
| `src/store/*.ts` | Storage facets → `@nikscripts/effect-pm/store/*` |
| `src/LogContext.ts`, `src/LogEntry.ts` | Log annotations (`LogAnnotationKeys`) + NDJSON log entries (`LogEntry` / `LogEntrySchema`) — the structured-logging core. |
| `src/internal/store/spine.ts`, `service.ts`, `helpers.ts` | Shared storage plumbing — internal. Type-agnostic only; per-facet codecs live next to each facet in `src/store/`. |
| `src/internal/manager/*` | Log capture / relay / query / scope (used by `Logs` + `store/log`) — **internal**. |
| `src/Logs.ts` | PM capture/relay only (`captureLoggerLayer`, `relayLayer`) — package subpath `@nikscripts/effect-pm/Logs`. |
| `src/disarmedIdleSleep.ts` | Pure policy for disarmed idle sleep (shared with tests). |
| `src/prisma/*` | Optional Prisma adapter (`@nikscripts/effect-pm/prisma` export). |
| `examples/forms/*` | One API shape per file — minimal teaching references. |
| `examples/scenarios/*` | Descriptive compositions showing subsystems together. |
| `examples/shared/*` | Test doubles, harness helpers, shared example utilities. |
| `docs/guides/*.md` | API guides — `toolkit-by-example.md`, `history-and-persistence.md`, `queue-resource.md`, `process.md`, `service-tags-and-runtime-split.md` (bundler-safe tags vs `Layer`/runtime). |
| `docs/plans/*.md` | Future-only roadmap items. Implemented behavior belongs in regular docs and source TSDoc. |
| `repos/effect/` | Vendored Effect source for read-only agent reference. **Do not import from it.** |
| `test/*.ts` | Vitest suites — run `pnpm test`. |

---

## Invariants (do not break casually)

1. **Supervisor semantics** — One fiber per started process; outer loop waits for **armed** schedule; inner loop runs **polling** ticks while armed. See `Process.ts` module doc.
2. **`Process.effect` typing** — `Process<R>`: `effect` needs the user environment plus optional storage facets supplied by `ProcessStorage.layer`. Inlined `polling` / `schedule` on `Process.make` are merged into the supervisor so **`R` excludes those services** when present (overload-resolved in `Process.ts`).
3. **Location transparency** — a `Resource` tag is driven by the same `yield* Tag` code local or remote; only the provided layer differs (`.layer` vs `.client`/`.serveHttp`). Don't special-case local vs remote in resource consumers.
4. **Storage** — See [STORAGE.md](./STORAGE.md) only (`RuntimeStorage` + `src/store/*` facets, `ProcessStore` builder, `ProcessStorage` combined layers). Toolkit persistence ports: `HistoryStore` / `DurableQueueStore` (SQLite backends in `storage/sqlite`).

---

## Public vs internal modules

**Rule:** If consumers import it in their app → public module under `src/` (PascalCase) and
documented export (`index.ts` or a `package.json` subpath). If only other package modules
use it → `src/internal/` — not exported from `index.ts`, no new subpath.

See [`.cursor/rules/public-vs-internal.mdc`](../.cursor/rules/public-vs-internal.mdc).

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
| Verify types (strict Effect rules) | `pnpm run typecheck` (uses `tsgo`). `anyUnknownInErrorContext` is temporarily `"off"` (re-enabling it is on the [roadmap](./plans/README.md)). |
| Run tests | `pnpm test` |
| Pick up future work | [`STORAGE.md`](./STORAGE.md) for the persistence model; [`docs/plans/README.md`](./plans/README.md) for the reviewed roadmap. |

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
- Examples that serve a resource over HTTP (`serveHttp`) bind to localhost ports. If an
  example fails because a port is already in use, rerun with a free port or stop the
  specific process that owns that port.
